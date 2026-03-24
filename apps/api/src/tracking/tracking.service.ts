import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { InjectRedis } from './redis.provider.js';
import { InjectQueue } from '@nestjs/bull';
import type { Redis } from 'ioredis';
import type { Queue } from 'bull';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthenticatedUser } from '../auth/auth.types.js';
import { PingDto } from './dto/ping.dto.js';

const LOCATION_TTL_SEC = 5 * 60; // 5 min cache in Redis
const PUBSUB_CHANNEL = 'courier_moved';

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

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectRedis() private readonly redis: Redis,
    @InjectQueue(PING_PERSIST_QUEUE) private readonly pingQueue: Queue<PingJob>,
  ) {}

  async handlePing(dto: PingDto, user: AuthenticatedUser): Promise<void> {
    if (!user.courier_id) {
      throw new ForbiddenException('Only courier accounts can send pings');
    }

    const courierId = user.courier_id;

    // Cache last known position in Redis (TTL 5 min)
    // Failure is non-fatal — DB is source of truth, cache miss is recovered next ping
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

    // Publish to Redis Pub/Sub → TrackingGateway fans out to WS room
    // Fire-and-forget: Redis drop must not cause a 500 to the courier
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

    // Enqueue async DB persist — decouples HTTP response from Postgres write
    await this.pingQueue.add(
      { courier_id: courierId, lat: dto.lat, lng: dto.lng, battery: dto.battery ?? null },
      { removeOnComplete: 100, removeOnFail: 50 },
    );
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
}
