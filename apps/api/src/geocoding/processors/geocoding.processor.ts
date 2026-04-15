import { Logger, Inject } from '@nestjs/common';
import { Processor, Process, OnQueueFailed } from '@nestjs/bull';
import { InjectQueue } from '@nestjs/bull';
import type { Job, Queue } from 'bull';
import type IORedis from 'ioredis';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { GeocodingService, GeocodeJob } from '../geocoding.service.js';
import { TelegramService } from '../../telegram/telegram.service.js';
import { MANAGER_EVENT } from '../../telegram/telegram.types.js';
import {
  GEOCODING_QUEUE,
  GEOCODING_DONE_CHANNEL,
  GEOCODING_FAILED_CHANNEL,
} from '../geocoding.constants.js';
import { REDIS_CLIENT } from '../../shared/redis/redis.constants.js';
import { haversineMeters } from '../../shared/geo.js';

export { GEOCODING_DONE_CHANNEL, GEOCODING_FAILED_CHANNEL };

export interface GeocodingDonePayload {
  orderId: string;
  lat: number;
  lng: number;
  establishmentId: string;
}

export interface GeocodingFailedPayload {
  orderId: string;
  address: string;
  establishmentId: string;
  reason: 'not_found' | 'proximity_failed' | 'transient_failure';
}

/**
 * Maximum distance (km) between geocoded delivery address and establishment location.
 * If the Nominatim result lands further away, it is almost certainly the wrong city —
 * Ukraine's largest city (Kyiv) fits within 25 km; inter-city distances are 50 km+.
 * Applied only when establishment.lat/lng are set.
 */
const GEOCODE_PROXIMITY_MAX_KM = 25;

/** How long (seconds) to suppress duplicate geocoding failure alerts per order. */
const GEOCODE_ALERT_DEDUP_TTL = 24 * 3600;

@Processor(GEOCODING_QUEUE)
export class GeocodingProcessor {
  private readonly logger = new Logger(GeocodingProcessor.name);

  constructor(
    private readonly geocodingService: GeocodingService,
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    @InjectQueue('dispatch') private readonly dispatchQueue: Queue,
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
  ) {}

  @Process()
  async handle(job: Job<GeocodeJob>): Promise<void> {
    const { orderId, address, establishmentId } = job.data;

    // Fetch establishment city (for Nominatim query scoping) + coords (for proximity check)
    const establishment = await this.prisma.establishment.findUnique({
      where: { id: establishmentId },
      select: { city: true, lat: true, lng: true },
    });

    // Append city so Nominatim scopes results correctly.
    // Without it, "вул. Незалежності, 1" could resolve to any of 100+ matching streets across Ukraine.
    const fullAddress = establishment?.city
      ? `${address}, ${establishment.city}`
      : address;

    if (!establishment?.city) {
      this.logger.warn(
        `Geocoding order ${orderId}: establishment city is not set — query sent without city scope (may reduce accuracy)`,
      );
    }

    const coords = await this.geocodingService.geocode(fullAddress);

    if (!coords) {
      this.logger.warn(
        `Geocoding returned null for order ${orderId}, address: "${fullAddress}"`,
      );
      await this.alertGeocodingFailure(
        orderId,
        address,
        establishmentId,
        'not_found',
      );
      return; // order stays with lat=null; recovery cron will retry after negative-cache TTL (10 min)
    }

    // ── Proximity validation ────────────────────────────────────────────────
    // If establishment has known coordinates, verify the geocoded result is within
    // GEOCODE_PROXIMITY_MAX_KM. A result outside this radius almost certainly belongs
    // to a different city — reject it to avoid routing couriers to the wrong location.
    if (establishment?.lat != null && establishment?.lng != null) {
      const distanceKm =
        haversineMeters(
          establishment.lat,
          establishment.lng,
          coords.lat,
          coords.lng,
        ) / 1000;

      if (distanceKm > GEOCODE_PROXIMITY_MAX_KM) {
        this.logger.error(
          `Geocoding proximity check FAILED for order ${orderId}: ` +
            `result is ${distanceKm.toFixed(1)} km from establishment (max ${GEOCODE_PROXIMITY_MAX_KM} km). ` +
            `Address: "${address}" → geocoded to ${coords.lat},${coords.lng}. Coordinates rejected.`,
        );
        await this.alertGeocodingFailure(
          orderId,
          address,
          establishmentId,
          'proximity_failed',
        );
        return; // order stays with lat=null; manager must set coordinates manually
      }
    }

    // ── Persist coordinates ─────────────────────────────────────────────────
    try {
      await this.prisma.order.update({
        where: { id: orderId },
        data: { lat: coords.lat, lng: coords.lng },
      });
    } catch (err) {
      // P2025: order was deleted (e.g. by retention) between enqueue and processing — skip silently
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        this.logger.warn(
          `Geocoding skipped — order ${orderId} no longer exists`,
        );
        return;
      }
      throw err;
    }

    // ── Notify dashboard and public tracking ───────────────────────────────
    const donePayload: GeocodingDonePayload = {
      orderId,
      lat: coords.lat,
      lng: coords.lng,
      establishmentId,
    };
    await this.redis.publish(
      GEOCODING_DONE_CHANNEL,
      JSON.stringify(donePayload),
    );

    this.logger.log(
      `Geocoded order ${orderId} ("${fullAddress}"): ${coords.lat},${coords.lng}`,
    );

    // ── Trigger auto-dispatch if order is still pending ────────────────────
    // When an order is created in auto-dispatch mode but has no coordinates yet,
    // the initial dispatch attempt returns { waiting: true }. Now that we have
    // coords, re-enqueue dispatch so the order is assigned without manager action.
    await this.triggerAutoDispatchIfNeeded(orderId, establishmentId);
  }

  /**
   * Called by Bull after all retry attempts are exhausted (transient failures:
   * Nominatim timeout, HTTP 5xx, network error). The job threw on every attempt,
   * meaning we never got a geocoding result — alert the manager to intervene.
   */
  @OnQueueFailed()
  async onFailed(job: Job<GeocodeJob>, err: Error): Promise<void> {
    const { orderId, address, establishmentId } = job.data;
    this.logger.error(
      `Geocoding permanently failed for order ${orderId} after all retries: ${err.message}`,
    );
    await this.alertGeocodingFailure(
      orderId,
      address,
      establishmentId,
      'transient_failure',
    );
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Sends a Telegram alert + WS event when geocoding cannot produce usable coordinates.
   * De-duplicated via Redis: only fires once per 24 hours per order to avoid spam
   * when the recovery cron re-queues the same order repeatedly.
   */
  private async alertGeocodingFailure(
    orderId: string,
    address: string,
    establishmentId: string,
    reason: GeocodingFailedPayload['reason'],
  ): Promise<void> {
    const dedupKey = `geocode:alert:${orderId}`;
    const alreadyAlerted = await this.redis.get(dedupKey);
    if (alreadyAlerted) return;

    await this.redis.set(dedupKey, reason, 'EX', GEOCODE_ALERT_DEDUP_TTL);

    // Broadcast to dashboard via WS (TrackingGateway subscribes to this channel)
    const failedPayload: GeocodingFailedPayload = {
      orderId,
      address,
      establishmentId,
      reason,
    };
    this.redis
      .publish(GEOCODING_FAILED_CHANNEL, JSON.stringify(failedPayload))
      .catch((err) =>
        this.logger.warn('Failed to publish geocoding:failed event', err),
      );

    // Telegram — fire-and-forget (never blocks delivery flow)
    const reasonText =
      reason === 'proximity_failed'
        ? 'геокодування повернуло координати занадто далеко від закладу (ймовірно, неправильне місто)'
        : reason === 'not_found'
          ? 'адресу не знайдено у базі карт OpenStreetMap'
          : 'помилка мережі при запиті до геокодера (всі спроби вичерпано)';

    const message =
      `⚠️ Замовлення без координат\n` +
      `Адреса: "${address}"\n` +
      `Причина: ${reasonText}\n` +
      `Встановіть координати вручну через кнопку «Карта» у дашборді.`;

    this.telegram
      .notifyEstablishmentManagers(
        establishmentId,
        message,
        MANAGER_EVENT.GEOCODE_FAILED,
      )
      .catch((err) => this.logger.warn('Telegram geocoding alert failed', err));
  }

  private async triggerAutoDispatchIfNeeded(
    orderId: string,
    establishmentId: string,
  ): Promise<void> {
    try {
      const [order, establishment] = await Promise.all([
        this.prisma.order.findUnique({
          where: { id: orderId },
          select: { status: true },
        }),
        this.prisma.establishment.findUnique({
          where: { id: establishmentId },
          select: { dispatch_mode: true },
        }),
      ]);

      if (
        order?.status === 'pending' &&
        establishment?.dispatch_mode === 'auto'
      ) {
        await this.dispatchQueue.add(
          { orderId, establishmentId, attempt: 1 },
          { jobId: `dispatch:${orderId}` },
        );
        this.logger.log(
          `Auto-dispatch re-triggered for order ${orderId} after geocoding`,
        );
      }
    } catch (err) {
      // Non-critical: dispatch will be retried by the next recommend-timeout-check cron
      this.logger.warn(
        `Failed to trigger auto-dispatch for order ${orderId} after geocoding`,
        err,
      );
    }
  }
}
