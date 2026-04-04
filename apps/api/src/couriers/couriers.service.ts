import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
  Inject,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthenticatedUser } from '../auth/auth.types.js';
import { CreateCourierDto } from './dto/create-courier.dto.js';
import { UpdateCourierDto } from './dto/update-courier.dto.js';
import { UpdateDeviceTokenDto } from './dto/update-device-token.dto.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { TelegramService } from '../telegram/telegram.service.js';
import { COURIERS_REDIS_CLIENT } from './couriers-redis.provider.js';

// Thresholds for online status (in ms)
const ONLINE_MS = 30_000;        // < 30s  → online
const BACKGROUND_MS = 5 * 60_000; // < 5min → background

const WORKLOAD_CACHE_TTL_SEC = 15;

interface WorkloadTodayRow {
  courier_id: string;
  name: string;
  workload_seconds: string | number;
  deliveries_count: string | number;
  avg_delay_minutes: string | number | null;
}

export interface WorkloadTodayCourier {
  courierId: string;
  name: string;
  workloadSeconds: number;
  deliveriesCount: number;
  avgDelayMinutes: number | null;
}

@Injectable()
export class CouriersService {
  private readonly logger = new Logger(CouriersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly telegram: TelegramService,
    @Inject(COURIERS_REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async findAll(user: AuthenticatedUser) {
    const couriers = await this.prisma.courier.findMany({
      where: { establishment_id: user.establishment_id },
      orderBy: { name: 'asc' },
    });

    if (couriers.length === 0) return [];

    const courierIds = couriers.map((c) => c.id);

    // Last ping per courier via DISTINCT ON (single query, includes lat/lng)
    const lastPings = await this.prisma.$queryRaw<
      { courier_id: string; created_at: Date; lat: number | null; lng: number | null }[]
    >`
      SELECT DISTINCT ON (courier_id)
        courier_id,
        created_at,
        ST_Y(location::geometry) AS lat,
        ST_X(location::geometry) AS lng
      FROM location_pings
      WHERE courier_id = ANY(${courierIds}::text[])
      ORDER BY courier_id, created_at DESC
    `;

    // Couriers with active deliveries (assigned or in_progress)
    const activeDeliveries = await this.prisma.delivery.findMany({
      where: {
        courier_id: { in: courierIds },
        status: { in: ['assigned', 'in_progress'] },
      },
      select: { courier_id: true },
    });
    const activeSet = new Set(activeDeliveries.map((d) => d.courier_id));

    // Active shifts per courier
    const activeShifts = await this.prisma.shift.findMany({
      where: { courier_id: { in: courierIds }, ended_at: null },
      select: { id: true, courier_id: true, started_at: true, planned_end_at: true },
    });
    const shiftMap = new Map(activeShifts.map((s) => [s.courier_id, s]));

    const pingMap = new Map(lastPings.map((p) => [p.courier_id, p]));

    return couriers.map((c) => {
      const ping = pingMap.get(c.id) ?? null;
      const activeShift = shiftMap.get(c.id) ?? null;
      const hasActiveDelivery = activeSet.has(c.id);
      return {
        ...c,
        last_ping_at: ping?.created_at ?? null,
        last_lat: ping?.lat ?? null,
        last_lng: ping?.lng ?? null,
        on_shift: activeShift !== null,
        active_shift: activeShift
          ? {
              id: activeShift.id,
              started_at: activeShift.started_at,
              planned_end_at: activeShift.planned_end_at,
            }
          : null,
        status: resolveStatus(ping?.created_at ?? null, hasActiveDelivery),
      };
    });
  }

  async findOne(id: string, user: AuthenticatedUser) {
    return this.assertBelongs(id, user.establishment_id);
  }

  async create(dto: CreateCourierDto, user: AuthenticatedUser) {
    this.assertManagerOrOwner(user);
    return this.prisma.courier.create({
      data: {
        establishment_id: user.establishment_id,
        name: dto.name,
        phone: dto.phone,
      },
    });
  }

  async update(id: string, dto: UpdateCourierDto, user: AuthenticatedUser) {
    this.assertManagerOrOwner(user);
    await this.assertBelongs(id, user.establishment_id);

    return this.prisma.courier.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string, user: AuthenticatedUser) {
    this.assertManagerOrOwner(user);
    await this.assertBelongs(id, user.establishment_id);

    return this.prisma.courier.delete({ where: { id } });
  }

  /** Courier self-registers their own FCM token (PATCH /me/device-token) */
  async updateMyDeviceToken(dto: UpdateDeviceTokenDto, user: AuthenticatedUser) {
    if (!user.courier_id) {
      throw new ForbiddenException('Only courier accounts can register a device token');
    }

    return this.prisma.courier.update({
      where: { id: user.courier_id },
      data: {
        device_token: dto.device_token,
        device_platform: dto.device_platform,
        ...(dto.device_brand ? { device_brand: dto.device_brand } : {}),
      },
      select: { id: true },
    });
  }

  /** Manager sends a push reminder to a courier (POST /:id/remind) */
  async remindCourier(courierId: string, user: AuthenticatedUser) {
    this.assertManagerOrOwner(user);
    const courier = await this.assertBelongs(courierId, user.establishment_id);

    await this.prisma.courier.update({
      where: { id: courierId },
      data: {
        last_reminder_sent_at: new Date(),
        reminder_count: { increment: 1 },
      },
    });

    this.notifications
      .sendPush(courierId, {
        title: 'Нагадування від менеджера',
        body: 'Перевірте застосунок — є активне замовлення',
        data: { type: 'reminder' },
      })
      .catch((err) => this.logger.warn(`FCM remind failed for ${courierId}`, err));

    this.telegram.notifyCourier(
      courierId,
      `📢 Нагадування від менеджера: перевірте застосунок — є активне замовлення`,
      'manager_reminder',
    ).catch((err: unknown) => this.logger.warn('Telegram notification failed (manager_reminder)', err));

    this.logger.log(`Reminder sent to courier ${courierId} by ${user.id}`);
    return { reminded: true, courier_name: courier.name };
  }

  /**
   * Returns workload statistics for all couriers currently on an active shift.
   * Cached in Redis for 15 seconds per establishment.
   * Accessible by manager, dispatcher, and courier roles (multi-tenant guard handles isolation).
   */
  async getWorkloadToday(establishmentId: string): Promise<{ couriers: WorkloadTodayCourier[] }> {
    const cacheKey = `workload:${establishmentId}`;

    // Try cache first
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as unknown;
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          Array.isArray((parsed as Record<string, unknown>).couriers)
        ) {
          return parsed as { couriers: WorkloadTodayCourier[] };
        }
      }
    } catch (err) {
      this.logger.warn('Redis get failed for workload cache — continuing to DB', err);
    }

    // Query all couriers on active shifts for this establishment
    const rows = await this.prisma.$queryRaw<WorkloadTodayRow[]>`
      SELECT
        c.id AS courier_id,
        c.name,
        COALESCE(
          SUM(EXTRACT(EPOCH FROM (d.completed_at - d.started_at)))
            FILTER (WHERE d.completed_at IS NOT NULL AND d.started_at IS NOT NULL),
          0
        )
        + COALESCE(
          SUM(CASE WHEN d.status IN ('assigned','in_progress') THEN d.eta_seconds ELSE 0 END),
          0
        ) AS workload_seconds,
        COUNT(d.id) FILTER (WHERE d.completed_at IS NOT NULL) AS deliveries_count,
        CASE
          WHEN COUNT(d.id) FILTER (WHERE d.eta_started_at IS NOT NULL AND d.completed_at IS NOT NULL) >= 1
          THEN AVG(
            EXTRACT(EPOCH FROM (d.completed_at - d.eta_started_at)) - d.eta_seconds
          ) FILTER (WHERE d.eta_started_at IS NOT NULL AND d.completed_at IS NOT NULL AND d.eta_seconds IS NOT NULL) / 60.0
          ELSE NULL
        END AS avg_delay_minutes
      FROM couriers c
      JOIN shifts s ON s.courier_id = c.id
        AND s.ended_at IS NULL
        AND s.establishment_id = ${establishmentId}
      LEFT JOIN deliveries d ON d.courier_id = c.id
        AND d.started_at >= s.started_at
        AND d.status NOT IN ('failed')
      WHERE c.establishment_id = ${establishmentId}
        AND c.active = true
      GROUP BY c.id, c.name, s.started_at
      ORDER BY workload_seconds DESC
    `;

    const couriers: WorkloadTodayCourier[] = rows.map((r) => ({
      courierId: r.courier_id,
      name: r.name,
      workloadSeconds: Number(r.workload_seconds),
      deliveriesCount: Number(r.deliveries_count),
      avgDelayMinutes: r.avg_delay_minutes !== null ? Number(r.avg_delay_minutes) : null,
    }));

    const result = { couriers };

    // Cache result
    try {
      await this.redis.setex(cacheKey, WORKLOAD_CACHE_TTL_SEC, JSON.stringify(result));
    } catch (err) {
      this.logger.warn('Redis setex failed for workload cache', err);
    }

    return result;
  }

  /**
   * Invalidates the workload cache for an establishment.
   * Called whenever delivery status changes in OrdersService / ProofOfDeliveryModule.
   */
  async invalidateWorkloadCache(establishmentId: string): Promise<void> {
    try {
      await this.redis.del(`workload:${establishmentId}`);
    } catch (err) {
      this.logger.warn(`Failed to invalidate workload cache for ${establishmentId}`, err);
    }
  }

  async clearDeviceToken(courierId: string): Promise<void> {
    // Called internally when FCM returns invalid_registration
    await this.prisma.courier.update({
      where: { id: courierId },
      data: { device_token: null, device_platform: null },
    }).catch((err) => {
      this.logger.warn(`Failed to clear device token for courier ${courierId}`, err);
    });
  }

  private async assertBelongs(courierId: string, establishmentId: string) {
    const courier = await this.prisma.courier.findUnique({
      where: { id: courierId },
    });

    if (!courier) throw new NotFoundException('Courier not found');
    if (courier.establishment_id !== establishmentId) {
      throw new ForbiddenException('Courier does not belong to your establishment');
    }

    return courier;
  }

  private assertManagerOrOwner(user: AuthenticatedUser): void {
    if (user.role !== 'owner' && user.role !== 'manager') {
      throw new ForbiddenException('Insufficient permissions');
    }
  }
}

function resolveStatus(
  pingAt: Date | null,
  hasActiveDelivery = false,
): 'online' | 'background' | 'not_responding' | 'offline' {
  if (!pingAt) return hasActiveDelivery ? 'not_responding' : 'offline';
  const age = Date.now() - pingAt.getTime();
  if (age < ONLINE_MS) return 'online';
  if (age < BACKGROUND_MS) return 'background';
  // ping > 5 min: if courier has active delivery → "not_responding" (🔴), else offline
  return hasActiveDelivery ? 'not_responding' : 'offline';
}
