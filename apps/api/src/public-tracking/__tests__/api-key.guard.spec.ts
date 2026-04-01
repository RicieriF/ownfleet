import { ExecutionContext, ForbiddenException, HttpException, UnauthorizedException } from '@nestjs/common';
import { ApiKeyGuard } from '../guards/api-key.guard.js';
import { ApiKeysService } from '../../api-keys/api-keys.service.js';

const EST_A = 'est-a';

function makeCtx(
  query: Record<string, string> = {},
  headers: Record<string, string> = {},
  params: Record<string, string> = {},
): ExecutionContext {
  const req: any = { query, headers, params };
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

const mockRedis = {
  multi: jest.fn().mockReturnValue({
    sadd: jest.fn().mockReturnThis(),
    scard: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([[null, 1], [null, 1], [null, 1]]),
  }),
};

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;

  beforeEach(() => {
    guard = new ApiKeyGuard(
      mockApiKeysService as unknown as ApiKeysService,
      mockRedis as any,
    );
    jest.clearAllMocks();
    mockRedis.multi.mockReturnValue({
      sadd: jest.fn().mockReturnThis(),
      scard: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, 1], [null, 1], [null, 1]]),
    });
  });

  // ── Missing key ────────────────────────────────────────────────────────────

  it('throws UnauthorizedException when key is missing', async () => {
    const ctx = makeCtx({}, { origin: 'https://pizza.com' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  // ── Invalid / inactive key ────────────────────────────────────────────────

  it('throws UnauthorizedException when key is invalid', async () => {
    mockApiKeysService.verifyKey.mockResolvedValue(null);
    const ctx = makeCtx({ key: 'wgo_bad_key' }, { origin: 'https://pizza.com' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  // ── No allowed domains ────────────────────────────────────────────────────

  it('throws ForbiddenException when allowed_domains is empty', async () => {
    mockApiKeysService.verifyKey.mockResolvedValue({
      ...validKeyRecord,
      allowed_domains: [],
    });
    const ctx = makeCtx({ key: 'wgo_validkey' }, { origin: 'https://pizza.com' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  // ── Domain check ──────────────────────────────────────────────────────────

  it('throws ForbiddenException when Origin domain not in allowed list', async () => {
    mockApiKeysService.verifyKey.mockResolvedValue(validKeyRecord);
    const ctx = makeCtx({ key: 'wgo_validkey' }, { origin: 'https://evil.com' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('allows exact domain match', async () => {
    mockApiKeysService.verifyKey.mockResolvedValue(validKeyRecord);
    const ctx = makeCtx({ key: 'wgo_validkey' }, { origin: 'https://pizza.com' });
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('allows subdomain match (sub.pizza.com when pizza.com in list)', async () => {
    mockApiKeysService.verifyKey.mockResolvedValue(validKeyRecord);
    const ctx = makeCtx({ key: 'wgo_validkey' }, { origin: 'https://order.pizza.com' });
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('denies request when Origin is absent (Referer is not trusted for domain check)', async () => {
    // Security fix: Referer can be spoofed by server-side requests; only Origin is trusted.
    // A missing Origin with no localhost fallback must be denied.
    mockApiKeysService.verifyKey.mockResolvedValue(validKeyRecord);
    const ctx = makeCtx({ key: 'wgo_validkey' }, { referer: 'https://pizza.com/menu' });
    await expect(guard.canActivate(ctx)).rejects.toThrow('Domain not allowed for this API key');
  });

  // ── Throttle ──────────────────────────────────────────────────────────────

  it('throws TooManyRequestsException when unique externalId count exceeds limit', async () => {
    mockApiKeysService.verifyKey.mockResolvedValue(validKeyRecord);
    // Simulate 11 unique entries already present
    mockRedis.multi.mockReturnValue({
      sadd: jest.fn().mockReturnThis(),
      scard: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, 1], [null, 11], [null, 1]]),
    });

    const ctx = makeCtx(
      { key: 'wgo_validkey', externalId: 'order-99' },
      { origin: 'https://pizza.com' },
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(HttpException);
  });

  it('allows request when unique externalId count is within limit', async () => {
    mockApiKeysService.verifyKey.mockResolvedValue(validKeyRecord);
    mockRedis.multi.mockReturnValue({
      sadd: jest.fn().mockReturnThis(),
      scard: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, 1], [null, 5], [null, 1]]),
    });

    const ctx = makeCtx(
      { key: 'wgo_validkey', externalId: 'order-1' },
      { origin: 'https://pizza.com' },
    );
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('skips throttle check when no externalId in query', async () => {
    mockApiKeysService.verifyKey.mockResolvedValue(validKeyRecord);
    const ctx = makeCtx({ key: 'wgo_validkey' }, { origin: 'https://pizza.com' });
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(mockRedis.multi).not.toHaveBeenCalled();
  });

  // ── Request decoration ────────────────────────────────────────────────────

  it('decorates req.apiKey with id, establishment_id, key_prefix', async () => {
    mockApiKeysService.verifyKey.mockResolvedValue(validKeyRecord);
    const req: any = { query: { key: 'wgo_validkey' }, headers: { origin: 'https://pizza.com' }, params: {} };
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
    const ctx = makeCtx({ key: 'wgo_validkey' }, { origin: 'https://pizza.com' });
    await guard.canActivate(ctx);
    expect(mockApiKeysService.updateLastUsed).toHaveBeenCalledWith('k1', 'pizza.com');
  });

  // ── localhost always allowed ──────────────────────────────────────────────

  it('allows localhost origin even when allowed_domains is empty', async () => {
    mockApiKeysService.verifyKey.mockResolvedValue({
      ...validKeyRecord,
      allowed_domains: [],
    });
    const ctx = makeCtx({ key: 'wgo_validkey' }, { origin: 'http://localhost:3000' });
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('allows 127.0.0.1 origin even when allowed_domains is empty', async () => {
    mockApiKeysService.verifyKey.mockResolvedValue({
      ...validKeyRecord,
      allowed_domains: [],
    });
    const ctx = makeCtx({ key: 'wgo_validkey' }, { origin: 'http://127.0.0.1:8080' });
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  // ── Throttle: same externalId 15 retries = 1 unique ──────────────────────

  it('does not throttle 15 retries of the same externalId (SADD is set-idempotent)', async () => {
    mockApiKeysService.verifyKey.mockResolvedValue(validKeyRecord);
    // SADD for a duplicate returns 0 (element already in set); SCARD stays at 1
    mockRedis.multi.mockReturnValue({
      sadd: jest.fn().mockReturnThis(),
      scard: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, 0], [null, 1], [null, 1]]),
    });

    // Simulate the 15th retry of the same order — scard=1, well under limit
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
      { key: 'wgo_validkey' },          // query: only API key
      { origin: 'https://pizza.com' },
      { externalId: 'order-from-path' }, // params: externalId from URL path
    );
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    // Redis throttle was invoked with the path param externalId
    expect(mockRedis.multi).toHaveBeenCalled();
  });
});
