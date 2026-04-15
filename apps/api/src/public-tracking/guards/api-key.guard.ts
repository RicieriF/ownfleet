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

// Per-key throttle: max unique externalIds per API key per minute.
// Blocks bulk enumeration even when attacker rotates IPs.
// 60/min ≈ 1 new customer/sec — covers the busiest legitimate establishments.
const KEY_THROTTLE_UNIQUE_LIMIT = 60;

// Per-IP throttle: max unique externalIds per client IP per key per minute.
// Primary defense against slow enumeration from a single origin:
// even requests well under the per-key limit are blocked at the IP level.
// Set generously to accommodate shared-NAT scenarios (corporate offices,
// mobile carriers) while still making full-order-history enumeration from
// one IP require constant proxy rotation (cost ↑, signal ↑).
const IP_THROTTLE_UNIQUE_LIMIT = 15;

const THROTTLE_TTL_SEC = 120; // 2 min window — survives minute-boundary edge cases

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
    // Domain restriction is enforced via the Origin header. Browsers enforce that
    // client-side JavaScript cannot override Origin, so this blocks unauthorized
    // websites from embedding the widget (the primary threat). Server-side code
    // (curl, backend fetch) CAN spoof Origin freely — this is an accepted trade-off
    // of the "public API key like Google Maps" design: the key is intentionally
    // visible in HTML and domain restriction guards against casual cross-site misuse,
    // not against a determined attacker who has already extracted the key.
    // Missing Origin (same-origin browser request) → treated as empty domain → denied.
    const origin = req.headers['origin'];
    const requestDomain = this.extractDomain(origin ?? '');

    // localhost is always allowed for development/testing (spec: "крім localhost для тестування")
    const isLocalhost =
      requestDomain === 'localhost' || requestDomain === '127.0.0.1';

    if (keyRecord.allowed_domains.length === 0 && !isLocalhost) {
      throw new ForbiddenException(
        'No allowed domains configured for this API key',
      );
    }

    const domainAllowed =
      isLocalhost ||
      keyRecord.allowed_domains.some((d) => {
        // Exact match only. www is handled by expandDomains() which stores both
        // "pizza.com" and "www.pizza.com". Wildcard subdomains are NOT allowed —
        // any subdomain takeover (*.pizza.com) would otherwise grant full key access.
        return requestDomain === d;
      });

    if (!domainAllowed) {
      this.logger.warn(
        `API key ${keyRecord.key_prefix} denied — domain '${requestDomain}' not in allowed list`,
      );
      throw new ForbiddenException('Domain not allowed for this API key');
    }

    // ── 4. Throttle: per-key + per-IP, single Redis pipeline ───────────────
    // externalId is a path param (/public/order/:externalId/token) or query param fallback
    const externalId =
      (req.params['externalId'] as string | undefined) ??
      (req.query['externalId'] as string | undefined);

    // Guard against excessively long externalIds that would bloat Redis SET members
    if (externalId && externalId.length > 128) {
      throw new HttpException('externalId too long', HttpStatus.BAD_REQUEST);
    }

    if (externalId) {
      const minuteBucket = Math.floor(Date.now() / 60_000);
      const keyThrottleKey = `throttle:api:key:${keyRecord.key_prefix}:${minuteBucket}`;

      // req.ip is populated correctly from X-Forwarded-For because
      // `trust proxy` is enabled in main.ts. Falls back to 'unknown' only
      // when running without any network context (unit tests, etc.).
      const clientIp = req.ip ?? 'unknown';
      const ipThrottleKey = `throttle:api:ip:${keyRecord.key_prefix}:${clientIp}:${minuteBucket}`;

      // Both checks in one pipeline — single round-trip to Redis.
      // Layout: [keyAdd, keyCard, keyExpire, ipAdd, ipCard, ipExpire]
      const results = await this.redis
        .multi()
        .sadd(keyThrottleKey, externalId)
        .scard(keyThrottleKey)
        .expire(keyThrottleKey, THROTTLE_TTL_SEC)
        .sadd(ipThrottleKey, externalId)
        .scard(ipThrottleKey)
        .expire(ipThrottleKey, THROTTLE_TTL_SEC)
        .exec();

      const keyUniqueCount = results?.[1]?.[1] as number | undefined;
      const ipUniqueCount = results?.[4]?.[1] as number | undefined;

      if (
        keyUniqueCount !== undefined &&
        keyUniqueCount > KEY_THROTTLE_UNIQUE_LIMIT
      ) {
        throw new HttpException(
          'Too many unique orders per minute for this API key',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      if (
        ipUniqueCount !== undefined &&
        ipUniqueCount > IP_THROTTLE_UNIQUE_LIMIT
      ) {
        // Generic message — don't reveal that IP-based limiting is active
        throw new HttpException(
          'Too many requests',
          HttpStatus.TOO_MANY_REQUESTS,
        );
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
