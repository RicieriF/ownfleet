import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type IORedis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../shared/redis/redis.constants.js';

/**
 * Health check — excluded from global prefix and all guards.
 * Responds at GET /health (not /api/v1/health).
 * Used by load balancers, uptime monitors, and docker healthcheck.
 *
 * Returns 200 when all checks pass, 503 when any check fails.
 * Response includes per-service status so monitoring can identify which
 * dependency is degraded without reading application logs.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
  ) {}

  @Get()
  async check(): Promise<{
    status: string;
    timestamp: string;
    services: { database: string; redis: string };
  }> {
    const [dbOk, redisOk] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      this.redis.ping().then((r) => r === 'PONG').catch(() => false),
    ]);

    const services = {
      database: dbOk ? 'ok' : 'error',
      redis: redisOk ? 'ok' : 'error',
    };

    if (!dbOk || !redisOk) {
      throw new ServiceUnavailableException({
        status: 'error',
        timestamp: new Date().toISOString(),
        services,
      });
    }

    return { status: 'ok', timestamp: new Date().toISOString(), services };
  }
}
