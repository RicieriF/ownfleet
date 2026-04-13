import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  Req,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { SkipThrottle, ThrottlerException } from '@nestjs/throttler';
import type { Request } from 'express';
import type IORedis from 'ioredis';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PlanAccessGuard } from '../establishments/guards/plan-access.guard.js';
import { PublicTrackingService } from './public-tracking.service.js';
import { ApiKeyGuard } from './guards/api-key.guard.js';
import { REDIS_CLIENT } from '../shared/redis/redis.constants.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { ApiKeyContext } from './guards/api-key.guard.js';

/** Max snapshot HTTP polls per token per minute. Clients should use WebSocket for live updates. */
const SNAPSHOT_RATE_LIMIT = 60;

@Controller('')
export class PublicTrackingController {
  constructor(
    private readonly service: PublicTrackingService,
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
  ) {}

  /**
   * Public: get or create tracking token by order external_id.
   * Requires a valid API key with an allowed domain.
   * Scoped to the establishment bound to the API key.
   * URL matches tracker.js spec: GET /api/v1/public/order/:externalId/token?key=API_KEY
   */
  @UseGuards(ApiKeyGuard)
  @Get('public/order/:externalId/token')
  async getPublicToken(
    @Param('externalId') externalId: string,
    @Req() req: Request,
  ) {
    const apiKey = req.apiKey as ApiKeyContext;
    return this.service.getTokenByExternalId(externalId, apiKey.establishment_id);
  }

  /**
   * Public: snapshot of current order/delivery state.
   * Requires a valid tracking token.
   *
   * Global IP throttle is skipped here intentionally: Next.js server-side components
   * (layout.tsx, page.tsx) fetch this endpoint from the same server IP for ALL
   * concurrent customers, so the 120/min global quota would aggregate across all
   * tracking sessions and throttle legitimate traffic at peak load.
   *
   * Protection against abuse: the token is a 122-bit UUID (impossible to enumerate)
   * and is validated against the DB on every request. Length check below provides
   * a fast-path rejection before the DB query.
   */
  @SkipThrottle()
  @Get('public/track/:token')
  async getSnapshot(@Param('token') token: string) {
    // Tokens are UUIDs (36 chars). Reject oversized values before hitting DB.
    if (!token || token.length > 64) {
      throw new NotFoundException('Tracking token not found or expired');
    }

    // Per-token rate limit: 60 req/min. Prevents hammering DB/Redis with rapid
    // snapshot polls even when a valid token is known. Clients should use WebSocket.
    const minuteBucket = Math.floor(Date.now() / 60_000);
    const rateLimitKey = `throttle:snap:${token}:${minuteBucket}`;
    const count = await this.redis
      .multi()
      .incr(rateLimitKey)
      .expire(rateLimitKey, 90) // 90s TTL — covers current + next bucket, then self-cleans
      .exec()
      .then((results) => (results?.[0]?.[1] as number | null) ?? 1)
      .catch(() => 0); // Redis unavailable — fail open (don't block legitimate users)
    if (count > SNAPSHOT_RATE_LIMIT) {
      throw new ThrottlerException();
    }

    const snapshot = await this.service.getSnapshot(token);
    if (!snapshot) {
      throw new NotFoundException('Tracking token not found or expired');
    }
    return snapshot;
  }

  /**
   * Manager: generate tracking token for a specific order.
   * Requires JWT auth + PlanAccessGuard.
   * Multi-tenant scoped: manager can only get tokens for their own orders.
   */
  @UseGuards(JwtAuthGuard, PlanAccessGuard)
  @Post('orders/:id/tracking-token')
  getManagerToken(@Param('id') id: string, @Req() req: Request) {
    return this.service.getTokenForManager(id, req.user as AuthenticatedUser);
  }
}
