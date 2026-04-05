import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TransportMode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TelegramService } from '../telegram/telegram.service.js';
import { parseEstablishmentSettings } from '../establishments/establishment-settings.js';
import { haversineMeters } from '../shared/geo.js';
import { MANAGER_EVENT } from '../telegram/telegram.types.js';

// OSRM routing profile per transport mode
const OSRM_PROFILE: Record<TransportMode, string> = {
  car: 'driving',
  moto_gas: 'driving',
  moto_electric: 'driving', // uses driving routes, but speed-corrected below
  bicycle: 'cycling',
  walking: 'foot',
};

// Electric moto max ~35 km/h vs urban car average ~50 km/h → duration multiplier
const MOTO_ELECTRIC_DURATION_FACTOR = 50 / 35; // ≈ 1.43

// Peak hour coefficients (applied in establishment's local timezone)
const PEAK_HOURS = [
  { start: 7, end: 9 },   // morning rush
  { start: 17, end: 19 }, // evening rush
] as const;
const PEAK_COEFFICIENT = 1.3;

// Buffer added to every delivery regardless of distance
const BUFFER_SECONDS = 3 * 60; // 3 minutes

// Minimum distance from establishment before ETA timer starts
const DEPARTURE_THRESHOLD_METERS = 100;

export interface EtaParams {
  establishmentLat: number;
  establishmentLng: number;
  orderLat: number;
  orderLng: number;
  transportMode: TransportMode;
  timezone: string;
}

@Injectable()
export class EtaService {
  private readonly logger = new Logger(EtaService.name);
  private readonly osrmUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly config: ConfigService,
  ) {
    this.osrmUrl = config.get<string>('OSRM_URL') ?? 'https://router.project-osrm.org';
  }

  /**
   * Calculate ETA in seconds from establishment to order address.
   * Returns null if OSRM is unreachable or coordinates are invalid.
   */
  async calculateEta(params: EtaParams): Promise<number | null> {
    const { establishmentLat, establishmentLng, orderLat, orderLng, transportMode, timezone } =
      params;

    const profile = OSRM_PROFILE[transportMode];
    const url = `${this.osrmUrl}/route/v1/${profile}/${establishmentLng},${establishmentLat};${orderLng},${orderLat}?overview=false`;

    let durationSeconds: number;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (!res.ok) {
        this.logger.warn(`OSRM returned ${res.status} for route request`);
        return null;
      }
      const data = (await res.json()) as {
        code: string;
        routes?: { duration: number }[];
      };
      if (data.code !== 'Ok' || !data.routes?.length) {
        this.logger.warn(`OSRM route not found: ${data.code}`);
        return null;
      }
      durationSeconds = data.routes[0]!.duration;
    } catch (err) {
      this.logger.warn('OSRM request failed', err);
      return null;
    }

    // Electric moto speed correction
    if (transportMode === TransportMode.moto_electric) {
      durationSeconds = durationSeconds * MOTO_ELECTRIC_DURATION_FACTOR;
    }

    // Peak hour coefficient based on establishment's local timezone
    const coefficient = this.getPeakCoefficient(timezone);
    durationSeconds = durationSeconds * coefficient;

    // Fixed buffer
    durationSeconds = durationSeconds + BUFFER_SECONDS;

    return Math.round(durationSeconds);
  }

  /**
   * Cron-driven. Finds all in_progress deliveries where ETA timer has expired
   * beyond the establishment's configured delay, and sends a Telegram alert.
   * Each delivery is alerted only once (eta_overdue_alerted_at guard).
   * Returns the number of alerts sent.
   */
  async checkOverdueDeliveries(): Promise<number> {
    const deliveries = await this.prisma.delivery.findMany({
      where: {
        status: 'in_progress',
        eta_started_at: { not: null },
        eta_seconds: { not: null },
        eta_overdue_alerted_at: null,
      },
      select: {
        id: true,
        eta_started_at: true,
        eta_seconds: true,
        courier: { select: { name: true } },
        order: {
          select: {
            address: true,
            establishment_id: true,
            establishment: { select: { settings: true, timezone: true } },
          },
        },
      },
    });

    const alertedIds: string[] = [];
    const now = new Date();

    for (const delivery of deliveries) {
      const settings = parseEstablishmentSettings(delivery.order.establishment.settings);
      if (!settings.eta_alert_enabled) continue;

      const delayMs = settings.eta_alert_delay_minutes * 60_000;
      const etaMs = delivery.eta_seconds! * 1_000;
      const overdueAt = new Date(delivery.eta_started_at!.getTime() + etaMs + delayMs);

      if (now < overdueAt) continue;

      const overdueMinutes = Math.round(
        (now.getTime() - delivery.eta_started_at!.getTime() - etaMs) / 60_000,
      );

      this.telegram
        .notifyEstablishmentManagers(
          delivery.order.establishment_id,
          `⏰ Доставка запізнюється на ${overdueMinutes} хв\nКурʼєр: ${delivery.courier.name}\nАдреса: ${delivery.order.address}`,
          MANAGER_EVENT.DELIVERY_ASSIGNED,
        )
        .catch((err: unknown) => this.logger.warn('Telegram notification failed (eta_overdue)', err));

      alertedIds.push(delivery.id);
    }

    if (alertedIds.length > 0) {
      await this.prisma.delivery.updateMany({
        where: { id: { in: alertedIds } },
        data: { eta_overdue_alerted_at: now },
      });
    }

    return alertedIds.length;
  }

  /**
   * Called on every GPS ping for a courier.
   * If the courier has an active in_progress delivery with ETA calculated but timer not yet started,
   * and the courier is now > 100m from the establishment — set eta_started_at.
   * Fire-and-forget: caller must not await.
   */
  async checkAndMarkDeparture(courierId: string, lat: number, lng: number): Promise<void> {
    const delivery = await this.prisma.delivery.findFirst({
      where: {
        courier_id: courierId,
        status: 'in_progress',
        eta_seconds: { not: null },
        eta_started_at: null,
      },
      select: {
        id: true,
        order: {
          select: {
            establishment: { select: { lat: true, lng: true } },
          },
        },
      },
    });

    if (!delivery) return;

    const est = delivery.order.establishment;
    if (est.lat === null || est.lng === null) return;

    const distanceMeters = haversineMeters(lat, lng, est.lat, est.lng);
    if (distanceMeters <= DEPARTURE_THRESHOLD_METERS) return;

    await this.prisma.delivery.update({
      where: { id: delivery.id },
      data: { eta_started_at: new Date() },
    });

    this.logger.debug(
      `ETA timer started for delivery ${delivery.id} — courier ${distanceMeters.toFixed(0)}m from establishment`,
    );
  }

  private getPeakCoefficient(timezone: string): number {
    const now = new Date();
    const localHour = Number(
      now.toLocaleString('en-US', { timeZone: timezone, hour: 'numeric', hour12: false }),
    );
    const isPeak = PEAK_HOURS.some(({ start, end }) => localHour >= start && localHour < end);
    return isPeak ? PEAK_COEFFICIENT : 1.0;
  }

}
