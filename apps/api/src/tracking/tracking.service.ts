import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { InjectRedis } from './redis.provider.js';
import type { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthenticatedUser } from '../auth/auth.types.js';
import { PingDto } from './dto/ping.dto.js';

const LOCATION_TTL_SEC = 5 * 60; // 5 min cache in Redis
const PUBSUB_CHANNEL = 'courier_moved';

export interface CourierMovedEvent {
  courier_id: string;
  establishment_id: string;
  lat: number;
  lng: number;
  battery: number | null;
  ts: number;
}

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async handlePing(dto: PingDto, user: AuthenticatedUser): Promise<void> {
    // Verify courier belongs to the authenticated establishment
    const courier = await this.prisma.courier.findUnique({
      where: { id: dto.courier_id },
      select: { id: true, establishment_id: true },
    });

    if (!courier || courier.establishment_id !== user.establishment_id) {
      throw new ForbiddenException('Courier does not belong to your establishment');
    }

    // Persist to DB using raw SQL for PostGIS geometry
    await this.prisma.$executeRaw`
      INSERT INTO location_pings (id, courier_id, location, battery, created_at)
      VALUES (
        gen_random_uuid(),
        ${dto.courier_id}::uuid,
        ST_SetSRID(ST_MakePoint(${dto.lng}, ${dto.lat}), 4326),
        ${dto.battery ?? null},
        NOW()
      )
    `;

    // Cache last known position in Redis (TTL 5 min)
    const redisKey = `courier:location:${dto.courier_id}`;
    await this.redis.setex(
      redisKey,
      LOCATION_TTL_SEC,
      JSON.stringify({ lat: dto.lat, lng: dto.lng, battery: dto.battery ?? null, ts: Date.now() }),
    );

    // Publish to Redis Pub/Sub → TrackingGateway fans out to WS room
    const event: CourierMovedEvent = {
      courier_id: dto.courier_id,
      establishment_id: courier.establishment_id,
      lat: dto.lat,
      lng: dto.lng,
      battery: dto.battery ?? null,
      ts: Date.now(),
    };

    await this.redis.publish(PUBSUB_CHANNEL, JSON.stringify(event));
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
    return JSON.parse(raw) as { lat: number; lng: number; battery: number | null; ts: number };
  }
}
