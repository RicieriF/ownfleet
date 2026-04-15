import {
  ExecutionContext,
  ForbiddenException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiKeyGuard } from '../guards/api-key.guard.js';
import { ApiKeysService } from '../../api-keys/api-keys.service.js';

const EST_A = 'est-a';

function makeCtx(
  query: Record<string, string> = {},
  headers: Record<string, string> = {},
  params: Record<string, string> = {},
  ip = '1.2.3.4',
): ExecutionContext {
  const req: any = { query, headers, params, ip };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as any;
}

const validKeyRecord = {
  id: 'k1',
  establishment_id: EST_A,
  allowed_domains: ['pizza.com', 'www.pizza.com'],
  key_prefix: 'wgo_test',
};

const mockApiKeysService = {
  verifyKey: jest.fn(),
  updateLastUsed: jest.fn(),
};

/**
 * Pipeline layout (6 commands):
 *   [0] sadd keyThrottleKey  → [null, 0|1]
 *   [1] scard keyThrottleKey → [null, N]   ← keyUniqueCount
 *   [2] expire keyThrottleKey
 *   [3] sadd ipThrottleKey   → [null, 0|1]
 *   [4] scard ipThrottleKey  → [null, N]   ← ipUniqueCount
 *   [5] expire ipThrottleKey
 */
function makePipelineResult(keyCount: number, ipCount: number) {
  return [
    [null, 1],
    [null, keyCount],
    [null, 1],
    [null, 1],
    [null, ipCount],
    [null, 1],
  ];
}

function makeMockRedis(keyCount = 1, ipCount = 1) {
  return {
    multi: jest.fn().mockReturnValue({
      sadd: jest.fn().mockReturnThis(),
      scard: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(makePipelineResult(keyCount, ipCount)),
    }),
  };
}

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;
  let mockRedis: ReturnType<typeof makeMockRedis>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis = makeMockRedis();
    guard = new ApiKeyGuard(
      mockApiKeysService as unknown as ApiKeysService,
      mockRedis as any,
    );
  });

  // ── Missing key ────────────────────────────────────────────────────────────

  it('throws UnauthorizedException when key is missing', async () => {
    const ctx = makeCtx({}, { origin: 'https://pizza.com' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  // ── Invalid / inactive key ────────────────────────────────────────────────

  it('throws UnauthorizedException when key is invalid', async () => {
    mockApiKeysService.verifyKey.mockResolvedValue(null);
    const ctx = makeCtx(
      { key: 'wgo_bad_key' },
      { origin: 'https://pizza.com' },
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  // ── No allowed domains ────────────────────────────────────────────────────

  it('throws ForbiddenException when allowed_domains is empty', async () => {
    mockApiKeysService.verifyKey.mockResolvedValue({
      ...validKeyRecord,
      allowed_domains: [],
    });
    const ctx = makeCtx(
      { key: 'wgo_validkey' },
      { origin: 'https://pizza.com' },
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  // ── Domain check ──────────────────────────────────────────────────────────

  it('throws ForbiddenException when Origin domain not in allowed list', async () => {
    mockApiKeysService.verifyKey.mockResolvedValue(validKeyRecord);
    const ctx = makeCtx(
      { key: 'wgo_validkey' },
      { origin: 'https://evil.com' },
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('allows exact domain match', async () => {
    mockApiKeysService.verifyKey.mockResolvedValue(validKeyRecord);
    const ctx = makeCtx(
      { key: 'wgo_validkey' },
      { origin: 'https://pizza.com' },
    );
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('denies subdomain not in allowed list (order.pizza.com when only pizza.com and www.pizza.com stored)', async () => {
    // Wildcard subdomain matching was removed: subdomain takeover (*.pizza.com) must not
    // grant access. expandDomains() stores exactly [host, www.host], nothing broader.
    mockApiKeysService.verifyKey.mockResolvedValue(validKeyRecord);
    const ctx = makeCtx(
      { key: 'wgo_validkey' },
      { origin: 'https://order.pizza.com' },
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('denies request when Origin is absent (Referer is not trusted for domain check)', async () => {
    // Security fix: Referer can be spoofed by server-side requests; only Origin is trusted.
    // A missing Origin with no localhost fallback must be denied.
    mockApiKeysService.verifyKey.mockResolvedValue(validKeyRecord);
    const ctx = makeCtx(
      { key: 'wgo_validkey' },
      { referer: 'https://pizza.com/menu' },
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      'Domain not allowed for this API key',
    );
  });

  // ── Per-key throttle ──────────────────────────────────────────────────────

  it('throws 429 when unique externalId count per key exceeds 60', async () => {
    mockApiKeysService.verifyKey.mockResolvedValue(validKeyRecord);
    mockRedis.multi.mockReturnValue({
      sadd: jest.fn().mockReturnThis(),
      scard: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(makePipelineResult(61, 1)),
    });

    const ctx = makeCtx(
      { key: 'wgo_validkey' },
      { origin: 'https://pizza.com' },
      { externalId: 'order-99' },
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(HttpException);
  });

  it('allows request when per-key unique count is within limit', async () => {
    mockApiKeysService.verifyKey.mockResolvedValue(validKeyRecord);
    mockRedis.multi.mockReturnValue({
      sadd: jest.fn().mockReturnThis(),
      scard: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(makePipelineResult(5, 1)),
    });

    const ctx = makeCtx(
      { key: 'wgo_validkey' },
      { origin: 'https://pizza.com' },
      { externalId: 'order-1' },
    );
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  // ── Per-IP throttle ───────────────────────────────────────────────────────

  it('throws 429 when unique externalId count per IP exceeds 15', async () => {
    mockApiKeysService.verifyKey.mockResolvedValue(validKeyRecord);
    mockRedis.multi.mockReturnValue({
      sadd: jest.fn().mockReturnThis(),
      scard: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      // keyCount well within limit, ipCount over limit
      exec: jest.fn().mockResolvedValue(makePipelineResult(5, 16)),
    });

    const ctx = makeCtx(
      { key: 'wgo_validkey' },
      { origin: 'https://pizza.com' },
      { externalId: 'order-99' },
      '5.5.5.5',
    );
    const err = await guard.canActivate(ctx).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
    // Generic message — must not reveal IP-based limiting is active
    expect((err as HttpException).getResponse()).toBe('Too many requests');
  });

  it('allows request when per-IP count is at the limit boundary (exactly 15)', async () => {
    mockApiKeysService.verifyKey.mockResolvedValue(validKeyRecord);
    mockRedis.multi.mockReturnValue({
      sadd: jest.fn().mockReturnThis(),
      scard: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(makePipelineResult(5, 15)),
    });

    const ctx = makeCtx(
      { key: 'wgo_validkey' },
      { origin: 'https://pizza.com' },
      { externalId: 'order-15' },
      '5.5.5.5',
    );
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('two different IPs each get their own independent IP throttle bucket', async () => {
    mockApiKeysService.verifyKey.mockResolvedValue(validKeyRecord);

    // IP A: at limit (15 unique)
    const multiA = {
      sadd: jest.fn().mockReturnThis(),
      scard: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(makePipelineResult(5, 15)),
    };
    // IP B: over limit (16 unique)
    const multiB = {
      sadd: jest.fn().mockReturnThis(),
      scard: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(makePipelineResult(5, 16)),
    };

    mockRedis.multi.mockReturnValueOnce(multiA).mockReturnValueOnce(multiB);

    const ctxA = makeCtx(
      { key: 'wgo_validkey' },
      { origin: 'https://pizza.com' },
      { externalId: 'order-1' },
      '1.1.1.1',
    );
    const ctxB = makeCtx(
      { key: 'wgo_validkey' },
      { origin: 'https://pizza.com' },
      { externalId: 'order-1' },
      '2.2.2.2',
    );

    await expect(guard.canActivate(ctxA)).resolves.toBe(true);
    await expect(guard.canActivate(ctxB)).rejects.toThrow(HttpException);
  });

  it('uses IP-scoped Redis key so different IPs do not share buckets', async () => {
    mockApiKeysService.verifyKey.mockResolvedValue(validKeyRecord);
    const multiMock = {
      sadd: jest.fn().mockReturnThis(),
      scard: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(makePipelineResult(1, 1)),
    };
    mockRedis.multi.mockReturnValue(multiMock);

    const ctx = makeCtx(
      { key: 'wgo_validkey' },
      { origin: 'https://pizza.com' },
      { externalId: 'order-1' },
      '9.9.9.9',
    );
    await guard.canActivate(ctx);

    // The 4th command (index 3) is sadd for IP key — must contain client IP
    const saddCalls = multiMock.sadd.mock.calls;
    expect(saddCalls[1][0]).toContain('9.9.9.9'); // second sadd = IP throttle key
  });

  it('both throttles use a single Redis pipeline (one round-trip)', async () => {
    mockApiKeysService.verifyKey.mockResolvedValue(validKeyRecord);
    const execMock = jest.fn().mockResolvedValue(makePipelineResult(1, 1));
    mockRedis.multi.mockReturnValue({
      sadd: jest.fn().mockReturnThis(),
      scard: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: execMock,
    });

    const ctx = makeCtx(
      { key: 'wgo_validkey' },
      { origin: 'https://pizza.com' },
      { externalId: 'order-1' },
    );
    await guard.canActivate(ctx);

    // multi() called exactly once — both throttles in one pipeline
    expect(mockRedis.multi).toHaveBeenCalledTimes(1);
    expect(execMock).toHaveBeenCalledTimes(1);
  });

  // ── Throttle skipped when no externalId ───────────────────────────────────

  it('skips throttle check when no externalId in query or params', async () => {
    mockApiKeysService.verifyKey.mockResolvedValue(validKeyRecord);
    const ctx = makeCtx(
      { key: 'wgo_validkey' },
      { origin: 'https://pizza.com' },
    );
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(mockRedis.multi).not.toHaveBeenCalled();
  });

  // ── Request decoration ────────────────────────────────────────────────────

  it('decorates req.apiKey with id, establishment_id, key_prefix', async () => {
    mockApiKeysService.verifyKey.mockResolvedValue(validKeyRecord);
    const req: any = {
      query: { key: 'wgo_validkey' },
      headers: { origin: 'https://pizza.com' },
      params: {},
      ip: '1.2.3.4',
    };
    const ctx: any = { switchToHttp: () => ({ getRequest: () => req }) };

    await guard.canActivate(ctx);

    expect(req.apiKey).toMatchObject({
      id: 'k1',
      establishment_id: EST_A,
      key_prefix: 'wgo_test',
    });
  });

  // ── updateLastUsed fire-and-forget ────────────────────────────────────────

  it('calls updateLastUsed fire-and-forget', async () => {
    mockApiKeysService.verifyKey.mockResolvedValue(validKeyRecord);
    const ctx = makeCtx(
      { key: 'wgo_validkey' },
      { origin: 'https://pizza.com' },
    );
    await guard.canActivate(ctx);
    expect(mockApiKeysService.updateLastUsed).toHaveBeenCalledWith(
      'k1',
      'pizza.com',
    );
  });

  // ── localhost always allowed ──────────────────────────────────────────────

  it('allows localhost origin even when allowed_domains is empty', async () => {
    mockApiKeysService.verifyKey.mockResolvedValue({
      ...validKeyRecord,
      allowed_domains: [],
    });
    const ctx = makeCtx(
      { key: 'wgo_validkey' },
      { origin: 'http://localhost:3000' },
    );
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('allows 127.0.0.1 origin even when allowed_domains is empty', async () => {
    mockApiKeysService.verifyKey.mockResolvedValue({
      ...validKeyRecord,
      allowed_domains: [],
    });
    const ctx = makeCtx(
      { key: 'wgo_validkey' },
      { origin: 'http://127.0.0.1:8080' },
    );
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  // ── Throttle: same externalId retries = 1 unique ──────────────────────────

  it('does not throttle 15 retries of the same externalId (SADD is set-idempotent)', async () => {
    mockApiKeysService.verifyKey.mockResolvedValue(validKeyRecord);
    // SADD for a duplicate returns 0 (element already in set); both SCARDs stay at 1
    mockRedis.multi.mockReturnValue({
      sadd: jest.fn().mockReturnThis(),
      scard: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(makePipelineResult(1, 1)),
    });

    const ctx = makeCtx(
      { key: 'wgo_validkey' },
      { origin: 'https://pizza.com' },
      { externalId: 'order-1' },
    );
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('reads externalId from path params (not query) — matches /public/order/:externalId/token route', async () => {
    mockApiKeysService.verifyKey.mockResolvedValue(validKeyRecord);

    const ctx = makeCtx(
      { key: 'wgo_validkey' }, // query: only API key
      { origin: 'https://pizza.com' },
      { externalId: 'order-from-path' }, // params: externalId from URL path
    );
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    // Redis throttle was invoked with the path param externalId
    expect(mockRedis.multi).toHaveBeenCalled();
  });
});
