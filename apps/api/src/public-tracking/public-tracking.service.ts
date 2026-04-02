import {
  Injectable,
  Logger,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type IORedis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthenticatedUser } from '../auth/auth.types.js';
import { REDIS_CLIENT } from '../shared/redis/redis.constants.js';
import {
  TRACKING_TOKEN_TTL_HOURS,
} from './public-tracking.constants.js';

export interface TrackSnapshot {
  orderStatus: string;
  deliveryStatus: string | null;
  courierName: string | null;
  courierTransportMode: string | null;
  courierLat: number | null;
  courierLng: number | null;
  orderLat: number | null;
  orderLng: number | null;
  etaSeconds: number | null;
  etaStartedAt: string | null;
  routeGeometry: unknown | null;
  address: string;
  slaDeadline: string | null;
  establishmentName: string;
  locale: string;
  tokenExpiresAt: string;
}

@Injectable()
export class PublicTrackingService {
  private readonly logger = new Logger(PublicTrackingService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
  ) {}

  /**
   * Generates or returns an existing tracking token for an order.
   * Uses the catch-P2002-then-findUnique idempotency pattern.
   */
  async getOrCreateToken(orderId: string): Promise<string> {
    const expiresAt = new Date(Date.now() + TRACKING_TOKEN_TTL_HOURS * 3600 * 1000);

    try {
      const created = await this.prisma.trackingToken.create({
        data: { order_id: orderId, expires_at: expiresAt },
        select: { token: true },
      });
      return created.token;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Concurrent creation — return the existing token
        const existing = await this.prisma.trackingToken.findUniqueOrThrow({
          where: { order_id: orderId },
          select: { token: true },
        });
        return existing.token;
      }
      throw err;
    }
  }

  /**
   * Resolves order by external_id scoped to the establishment from the API key.
   * Returns the tracking token.
   */
  async getTokenByExternalId(
    externalId: string,
    establishmentId: string,
  ): Promise<{ token: string }> {
    const order = await this.prisma.order.findFirst({
      where: { external_id: externalId, establishment_id: establishmentId },
      select: { id: true },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const token = await this.getOrCreateToken(order.id);
    return { token };
  }

  /**
   * Manager endpoint: generate tracking token for an order by order ID.
   * Scoped to the manager's establishment for multi-tenant isolation.
   */
  async getTokenForManager(orderId: string, user: AuthenticatedUser): Promise<{ token: string }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, establishment_id: true },
    });
    if (!order || order.establishment_id !== user.establishment_id) {
      throw new NotFoundException('Order not found');
    }

    const token = await this.getOrCreateToken(orderId);
    return { token };
  }

  /**
   * Snapshot — returns current state of order/delivery for the tracking page.
   * Returns null if token not found or expired.
   *
   * Delivery lookup uses reassignment rule:
   *   most recent delivery WHERE status != 'failed', ORDER BY assigned_at DESC
   *
   * etaSeconds is computed server-side:
   *   - eta_started_at IS NULL: original eta_seconds (курʼєр ще не виїхав)
   *   - eta_started_at IS NOT NULL: max(0, eta_seconds - elapsed) (динамічний залишок)
   *
   * routeGeometry is read from Redis cache `route:{delivery_id}` (TTL 60s).
   */
  async getSnapshot(token: string): Promise<TrackSnapshot | null> {
    const trackingToken = await this.prisma.trackingToken.findUnique({
      where: { token },
      select: { order_id: true, expires_at: true },
    });

    if (!trackingToken || trackingToken.expires_at < new Date()) {
      return null;
    }

    const order = await this.prisma.order.findUnique({
      where: { id: trackingToken.order_id },
      select: {
        status: true,
        lat: true,
        lng: true,
        address: true,
        ready_at: true,
        created_at: true,
        establishment: {
          select: {
            name: true,
            delivery_sla_minutes: true,
            settings: true,
          },
        },
      },
    });

    if (!order) return null;

    // Reassignment rule: most recent non-failed delivery
    const delivery = await this.prisma.delivery.findFirst({
      where: {
        order_id: trackingToken.order_id,
        status: { not: 'failed' },
      },
      orderBy: { assigned_at: 'desc' },
      select: {
        id: true,
        courier_id: true,
        status: true,
        eta_seconds: true,
        eta_started_at: true,
        courier: { select: { name: true, transport_mode: true } },
      },
    });

    // Compute remaining ETA
    let etaSeconds: number | null = null;
    if (delivery?.eta_seconds != null) {
      if (delivery.eta_started_at) {
        const elapsedSeconds = Math.floor(
          (Date.now() - delivery.eta_started_at.getTime()) / 1000,
        );
        etaSeconds = Math.max(0, delivery.eta_seconds - elapsedSeconds);
      } else {
        etaSeconds = delivery.eta_seconds;
      }
    }

    // Courier last known position from Redis (best-effort, null on miss/error).
    // TrackingService caches each GPS ping under courier:location:{courierId} (TTL 5 min).
    // Provides the initial marker position so the map doesn't appear empty on load/reconnect
    // while waiting for the next 15s location ping via WebSocket.
    let courierLat: number | null = null;
    let courierLng: number | null = null;
    if (delivery?.courier_id && delivery.status === 'in_progress') {
      try {
        const cached = await this.redis.get(`courier:location:${delivery.courier_id}`);
        if (cached) {
          const pos = JSON.parse(cached) as { lat: number; lng: number };
          courierLat = pos.lat;
          courierLng = pos.lng;
        }
      } catch {
        // Redis unavailable or parse error — graceful degradation
      }
    }

    // Route geometry from Redis cache (best-effort, null on miss/error)
    let routeGeometry: unknown | null = null;
    if (delivery?.id && delivery.status === 'in_progress') {
      try {
        const cached = await this.redis.get(`route:${delivery.id}`);
        if (cached) routeGeometry = JSON.parse(cached) as unknown;
      } catch {
        // Redis unavailable or parse error — graceful degradation
      }
    }

    // SLA deadline: COALESCE(ready_at, created_at) + delivery_sla_minutes
    let slaDeadline: string | null = null;
    if (order.establishment.delivery_sla_minutes && delivery) {
      const baseTime = order.ready_at ?? order.created_at;
      const deadline = new Date(
        baseTime.getTime() + order.establishment.delivery_sla_minutes * 60 * 1000,
      );
      slaDeadline = deadline.toISOString();
    }

    // Locale from establishment settings JSONB (default 'uk')
    const settings = order.establishment.settings as Record<string, unknown> | null;
    const locale = (settings?.['locale'] as string | undefined) ?? 'uk';

    return {
      orderStatus: order.status,
      deliveryStatus: delivery?.status ?? null,
      courierName: delivery?.courier.name ?? null,
      courierTransportMode: delivery?.courier.transport_mode ?? null,
      courierLat,
      courierLng,
      orderLat: order.lat,
      orderLng: order.lng,
      etaSeconds,
      etaStartedAt: delivery?.eta_started_at?.toISOString() ?? null,
      routeGeometry,
      address: order.address,
      slaDeadline,
      establishmentName: order.establishment.name,
      locale,
      tokenExpiresAt: trackingToken.expires_at.toISOString(),
    };
  }
}
