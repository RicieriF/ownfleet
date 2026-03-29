import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
  ForbiddenException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import type IORedis from 'ioredis';
import { Inject } from '@nestjs/common';
import { ApiKeysService } from '../../api-keys/api-keys.service.js';
import { REDIS_CLIENT } from '../../shared/redis/redis.constants.js';

// Unique external_id throttle: SADD per (keyPrefix + minuteBucket)
const THROTTLE_UNIQUE_LIMIT = 10;
const THROTTLE_TTL_SEC = 120; // 2 min window

export interface ApiKeyContext {
  id: string;
  establishment_id: string;
  key_prefix: string;
}

declare module 'express' {
  interface Request {
    apiKey?: ApiKeyContext;
  }
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(
    private readonly apiKeysService: ApiKeysService,
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    // ── 1. Extract key ──────────────────────────────────────────────────────
    const rawKey = (req.query['key'] as string | undefined) ?? '';
    if (!rawKey) {
      throw new UnauthorizedException('Missing API key');
    }

    // ── 2. HMAC verify + is_active ──────────────────────────────────────────
    const keyRecord = await this.apiKeysService.verifyKey(rawKey);
    if (!keyRecord) {
      throw new UnauthorizedException('Invalid or inactive API key');
    }

    // ── 3. Origin check ─────────────────────────────────────────────────────
    const origin = req.headers['origin'] as string | undefined;
    const referer = req.headers['referer'] as string | undefined;
    const requestDomain = this.extractDomain(origin ?? referer ?? '');

    if (keyRecord.allowed_domains.length === 0) {
      throw new ForbiddenException('No allowed domains configured for this API key');
    }

    const domainAllowed = keyRecord.allowed_domains.some((d) => {
      // Exact match or suffix match (sub.pizza.com allowed if pizza.com is in list)
      return requestDomain === d || requestDomain.endsWith(`.${d}`);
    });

    if (!domainAllowed) {
      this.logger.warn(
        `API key ${keyRecord.key_prefix} denied — domain '${requestDomain}' not in allowed list`,
      );
      throw new ForbiddenException('Domain not allowed for this API key');
    }

    // ── 4. Throttle: unique externalIds per key per minute ──────────────────
    // externalId is a path param (/public/order/:externalId/token) or query param fallback
    const externalId =
      (req.params['externalId'] as string | undefined) ??
      (req.query['externalId'] as string | undefined);
    if (externalId) {
      const minuteBucket = Math.floor(Date.now() / 60_000);
      const throttleKey = `throttle:api:${keyRecord.key_prefix}:${minuteBucket}`;

      const count = await this.redis
        .multi()
        .sadd(throttleKey, externalId)
        .scard(throttleKey)
        .expire(throttleKey, THROTTLE_TTL_SEC)
        .exec();

      const uniqueCount = count?.[1]?.[1] as number | undefined;
      if (uniqueCount !== undefined && uniqueCount > THROTTLE_UNIQUE_LIMIT) {
        throw new HttpException('Too many unique orders per minute for this API key', HttpStatus.TOO_MANY_REQUESTS);
      }
    }

    // ── 5. Decorate request ─────────────────────────────────────────────────
    req.apiKey = {
      id: keyRecord.id,
      establishment_id: keyRecord.establishment_id,
      key_prefix: keyRecord.key_prefix,
    };

    // Fire-and-forget last_used update
    this.apiKeysService.updateLastUsed(keyRecord.id, requestDomain || null);

    return true;
  }

  private extractDomain(urlOrOrigin: string): string {
    try {
      if (!urlOrOrigin) return '';
      const parsed = urlOrOrigin.startsWith('http')
        ? new URL(urlOrOrigin)
        : new URL(`https://${urlOrOrigin}`);
      return parsed.hostname.toLowerCase();
    } catch {
      return '';
    }
  }
}
