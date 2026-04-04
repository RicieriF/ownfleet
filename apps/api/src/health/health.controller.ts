import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import type IORedis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../shared/redis/redis.constants.js';
import { PING_PERSIST_QUEUE } from '../tracking/tracking.service.js';
import { WEBHOOK_QUEUE } from '../webhooks/webhooks.service.js';

// npm sets npm_package_version when running any npm script (start, test, etc.)
const APP_VERSION: string = process.env['npm_package_version'] ?? 'unknown';

/**
 * Health check — excluded from global prefix and all guards.
 * Responds at GET /health (not /api/v1/health).
 * Used by load balancers, uptime monitors, and docker healthcheck.
 *
 * Returns 200 when all checks pass, 503 when any check fails.
 * Response includes per-service status so monitoring can identify which
 * dependency is degraded without reading application logs.
 *
 * Queue checks detect paused workers (ops incident — someone called queue.pause()
 * or a worker process crashed leaving the queue in a degraded state).
 * A paused queue causes 503 since jobs are silently accumulating without processing.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
    @InjectQueue(PING_PERSIST_QUEUE) private readonly pingQueue: Queue,
    @InjectQueue(WEBHOOK_QUEUE) private readonly webhookQueue: Queue,
  ) {}

  @Get()
  async check(): Promise<{
    status: string;
    timestamp: string;
    services: { database: string; redis: string; queues: Record<string, string>; version: string };
  }> {
    const [dbOk, redisOk, pingPaused, webhookPaused] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      this.redis.ping().then((r) => r === 'PONG').catch(() => false),
      this.pingQueue.isPaused().catch(() => null as boolean | null),
      this.webhookQueue.isPaused().catch(() => null as boolean | null),
    ]);

    const queues: Record<string, string> = {
      [PING_PERSIST_QUEUE]: pingPaused === null ? 'error' : pingPaused ? 'paused' : 'ok',
      [WEBHOOK_QUEUE]: webhookPaused === null ? 'error' : webhookPaused ? 'paused' : 'ok',
    };

    const services = {
      database: dbOk ? 'ok' : 'error',
      redis: redisOk ? 'ok' : 'error',
      queues,
      version: APP_VERSION,
    };

    const queuesDegraded = Object.values(queues).some((s) => s !== 'ok');

    if (!dbOk || !redisOk || queuesDegraded) {
      throw new ServiceUnavailableException({
        status: 'error',
        timestamp: new Date().toISOString(),
        services,
      });
    }

    return { status: 'ok', timestamp: new Date().toISOString(), services };
  }
}
