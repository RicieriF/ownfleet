import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthenticatedUser } from '../auth/auth.types.js';
import { CreateCourierDto } from './dto/create-courier.dto.js';
import { UpdateCourierDto } from './dto/update-courier.dto.js';
import { RegisterDeviceTokenDto } from './dto/register-device-token.dto.js';
import { UpdateDeviceTokenDto } from './dto/update-device-token.dto.js';
import { NotificationsService } from '../notifications/notifications.service.js';

// Thresholds for online status (in ms)
const ONLINE_MS = 30_000;        // < 30s  → online
const BACKGROUND_MS = 5 * 60_000; // < 5min → background

@Injectable()
export class CouriersService {
  private readonly logger = new Logger(CouriersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
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

  async registerDeviceToken(
    courierId: string,
    dto: RegisterDeviceTokenDto,
    user: AuthenticatedUser,
  ) {
    // Called by the courier app after login — user.id is the courier's linked user
    // or by manager on behalf. We verify courier belongs to establishment.
    await this.assertBelongs(courierId, user.establishment_id);

    return this.prisma.courier.update({
      where: { id: courierId },
      data: {
        device_token: dto.token,
        device_platform: dto.platform,
        device_brand: dto.brand,
      },
      select: { id: true },
    });
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

    this.logger.log(`Reminder sent to courier ${courierId} by ${user.id}`);
    return { reminded: true, courier_name: courier.name };
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
