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

// Thresholds for online status (in ms)
const ONLINE_MS = 30_000;        // < 30s  → online
const BACKGROUND_MS = 5 * 60_000; // < 5min → background

@Injectable()
export class CouriersService {
  private readonly logger = new Logger(CouriersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(user: AuthenticatedUser) {
    const couriers = await this.prisma.courier.findMany({
      where: { establishment_id: user.establishment_id },
      orderBy: { name: 'asc' },
    });

    if (couriers.length === 0) return [];

    // Single query: last ping per courier via DISTINCT ON
    const lastPings = await this.prisma.$queryRaw<
      { courier_id: string; created_at: Date }[]
    >`
      SELECT DISTINCT ON (courier_id) courier_id, created_at
      FROM location_pings
      WHERE courier_id = ANY(${couriers.map((c) => c.id)}::uuid[])
      ORDER BY courier_id, created_at DESC
    `;

    const pingMap = new Map(lastPings.map((p) => [p.courier_id, p.created_at]));

    return couriers.map((c) => {
      const pingAt = pingMap.get(c.id) ?? null;
      return { ...c, last_ping_at: pingAt, online_status: resolveStatus(pingAt) };
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

function resolveStatus(pingAt: Date | null): 'online' | 'background' | 'offline' {
  if (!pingAt) return 'offline';
  const age = Date.now() - pingAt.getTime();
  if (age < ONLINE_MS) return 'online';
  if (age < BACKGROUND_MS) return 'background';
  return 'offline';
}
