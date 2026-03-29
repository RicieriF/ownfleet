import { Injectable, ForbiddenException, Logger, Inject } from '@nestjs/common';
import { InjectRedis } from './redis.provider.js';
import { InjectQueue } from '@nestjs/bull';
import type { Redis } from 'ioredis';
import type { Queue } from 'bull';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthenticatedUser } from '../auth/auth.types.js';
import { PingDto } from './dto/ping.dto.js';
import { TransportMode } from '@prisma/client';
import { ConfigService } from '@nestjs/config';

const LOCATION_TTL_SEC = 5 * 60; // 5 min cache in Redis
const PUBSUB_CHANNEL = 'courier_moved';
const ROUTE_DEVIATION_THRESHOLD_M = 50;
const OSRM_PROFILE: Record<TransportMode, string> = {
  car: 'driving',
  moto_gas: 'driving',
  moto_electric: 'driving',
  bicycle: 'cycling',
  walking: 'foot',
};

export const PING_PERSIST_QUEUE = 'ping-persist';

export interface PingJob {
  courier_id: string;
  lat: number;
  lng: number;
  battery: number | null;
}

export interface CourierMovedEvent {
  courier_id: string;
  establishment_id: string;
  lat: number;
  lng: number;
  battery: number | null;
  ts: number;
}

/** Value stored in courier:active_order:{courierId} */
export interface ActiveOrderCache {
  orderId: string;
  deliveryId: string;
  orderLat: number | null;
  orderLng: number | null;
  transportProfile: string;
}

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);
  private readonly osrmUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    @InjectRedis() private readonly redis: Redis,
    @InjectQueue(PING_PERSIST_QUEUE) private readonly pingQueue: Queue<PingJob>,
    config: ConfigService,
  ) {
    this.osrmUrl = config.get<string>('OSRM_URL') ?? 'https://router.project-osrm.org';
  }

  async handlePing(dto: PingDto, user: AuthenticatedUser): Promise<void> {
    if (!user.courier_id) {
      throw new ForbiddenException('Only courier accounts can send pings');
    }

    const courierId = user.courier_id;

    // ── Cache last known location ──────────────────────────────────────────
    const redisKey = `courier:location:${courierId}`;
    try {
      await this.redis.setex(
        redisKey,
        LOCATION_TTL_SEC,
        JSON.stringify({ lat: dto.lat, lng: dto.lng, battery: dto.battery ?? null, ts: Date.now() }),
      );
    } catch (err) {
      this.logger.warn('Redis setex failed for ping cache — continuing', err);
    }

    // ── Pub/Sub to manager dashboard ───────────────────────────────────────
    const event: CourierMovedEvent = {
      courier_id: courierId,
      establishment_id: user.establishment_id,
      lat: dto.lat,
      lng: dto.lng,
      battery: dto.battery ?? null,
      ts: Date.now(),
    };
    this.redis.publish(PUBSUB_CHANNEL, JSON.stringify(event)).catch((err) =>
      this.logger.warn('Redis publish failed for courier_moved event', err),
    );

    // ── Public tracking: location + route deviation ────────────────────────
    void this.handlePublicTracking(courierId, dto.lat, dto.lng);

    // ── Async DB persist ───────────────────────────────────────────────────
    await this.pingQueue.add(
      { courier_id: courierId, lat: dto.lat, lng: dto.lng, battery: dto.battery ?? null },
      { removeOnComplete: 100, removeOnFail: 50 },
    );
  }

  private async handlePublicTracking(
    courierId: string,
    lat: number,
    lng: number,
  ): Promise<void> {
    try {
      const raw = await this.redis.get(`courier:active_order:${courierId}`);
      if (!raw) return; // courier has no active delivery

      const active = JSON.parse(raw) as ActiveOrderCache;
      const { orderId, deliveryId, orderLat, orderLng, transportProfile } = active;

      // Publish location to public WS channel
      this.redis.publish(
        `order:${orderId}:public`,
        JSON.stringify({ type: 'location', lat, lng, ts: Date.now() }),
      ).catch(() => {});

      // Route deviation check
      if (orderLat === null || orderLng === null) return;

      const originRaw = await this.redis.get(`route:origin:${deliveryId}`);
      if (!originRaw) return;

      const origin = JSON.parse(originRaw) as { lat: number; lng: number };
      const distance = this.haversineMeters(lat, lng, origin.lat, origin.lng);

      if (distance < ROUTE_DEVIATION_THRESHOLD_M) return;

      // Check cooldown
      const cooldownKey = `route:recalc_cooldown:${deliveryId}`;
      const hasCooldown = await this.redis.exists(cooldownKey);
      if (hasCooldown) return;

      // OSRM route recalc
      const routeGeometry = await this.fetchRouteGeometry(
        lat, lng, orderLat, orderLng, transportProfile,
      );
      if (!routeGeometry) return;

      // Publish route to public WS channel
      this.redis.publish(
        `order:${orderId}:public`,
        JSON.stringify({ type: 'route', routeGeometry }),
      ).catch(() => {});

      // Update route:origin to current position
      await this.redis.set(
        `route:origin:${deliveryId}`,
        JSON.stringify({ lat, lng }),
      );

      // Set cooldown TTL=60s
      await this.redis.set(cooldownKey, '1', 'EX', 60);
    } catch (err) {
      this.logger.warn('handlePublicTracking error — non-fatal', err);
    }
  }

  // ── Redis key management for active deliveries ─────────────────────────

  /**
   * Called by OrdersService when a delivery is assigned.
   * Sets the courier:active_order key and route:origin key.
   */
  async setActiveOrder(
    courierId: string,
    orderId: string,
    deliveryId: string,
    orderLat: number | null,
    orderLng: number | null,
    transportMode: TransportMode | null,
    establishmentLat: number | null,
    establishmentLng: number | null,
  ): Promise<void> {
    const transportProfile = transportMode ? (OSRM_PROFILE[transportMode] ?? 'driving') : 'driving';

    const activeOrder: ActiveOrderCache = {
      orderId,
      deliveryId,
      orderLat,
      orderLng,
      transportProfile,
    };

    // TTL 8h as safety net — DEL'd explicitly on complete/cancel/reassign
    await this.redis.set(
      `courier:active_order:${courierId}`,
      JSON.stringify(activeOrder),
      'EX',
      8 * 3600,
    );

    // Set route:origin to establishment coordinates if available
    if (establishmentLat !== null && establishmentLng !== null) {
      await this.redis.set(
        `route:origin:${deliveryId}`,
        JSON.stringify({ lat: establishmentLat, lng: establishmentLng }),
      );
    }
  }

  /**
   * Called by OrdersService / ProofOfDeliveryService when delivery ends.
   * Clears the courier:active_order and route keys.
   */
  async clearActiveOrder(courierId: string, deliveryId: string): Promise<void> {
    await Promise.all([
      this.redis.del(`courier:active_order:${courierId}`),
      this.redis.del(`route:origin:${deliveryId}`),
      this.redis.del(`route:${deliveryId}`),
    ]).catch((err) => this.logger.warn('clearActiveOrder Redis error', err));
  }

  async getLastKnownPosition(
    courierId: string,
    establishmentId: string,
  ): Promise<{ lat: number; lng: number; battery: number | null; ts: number } | null> {
    const courier = await this.prisma.courier.findUnique({
      where: { id: courierId },
      select: { establishment_id: true },
    });

    if (!courier || courier.establishment_id !== establishmentId) {
      throw new ForbiddenException('Courier does not belong to your establishment');
    }

    const raw = await this.redis.get(`courier:location:${courierId}`);
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (
        typeof parsed !== 'object' || parsed === null ||
        typeof (parsed as Record<string, unknown>).lat !== 'number' ||
        typeof (parsed as Record<string, unknown>).lng !== 'number' ||
        typeof (parsed as Record<string, unknown>).ts !== 'number'
      ) {
        this.logger.warn(`Corrupted Redis location for courier ${courierId} — discarding`);
        return null;
      }
      const p = parsed as { lat: number; lng: number; battery: unknown; ts: number };
      return { lat: p.lat, lng: p.lng, battery: typeof p.battery === 'number' ? p.battery : null, ts: p.ts };
    } catch {
      this.logger.warn(`Failed to parse Redis location for courier ${courierId}`);
      return null;
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6_371_000;
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private async fetchRouteGeometry(
    fromLat: number,
    fromLng: number,
    toLat: number,
    toLng: number,
    profile: string,
  ): Promise<unknown | null> {
    const url =
      `${this.osrmUrl}/route/v1/${profile}/${fromLng},${fromLat};${toLng},${toLat}` +
      `?overview=simplified&geometries=geojson`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'weego-cmi/1.0' },
      });
      clearTimeout(timer);
      if (!res.ok) return null;

      const data = (await res.json()) as {
        code: string;
        routes?: Array<{ geometry: unknown }>;
      };
      return data.routes?.[0]?.geometry ?? null;
    } catch {
      clearTimeout(timer);
      return null;
    }
  }
}
