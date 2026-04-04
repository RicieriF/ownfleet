import { Test, TestingModule } from '@nestjs/testing';
import { DistributedLockService } from '../distributed-lock.service.js';
import { REDIS_CLIENT } from '../redis.constants.js';

// Minimal IORedis mock — only the methods DistributedLockService uses
const makeRedisMock = () => ({
  set: jest.fn(),
  del: jest.fn().mockResolvedValue(1),
  expire: jest.fn().mockResolvedValue(1),
});

describe('DistributedLockService', () => {
  let service: DistributedLockService;
  let redis: ReturnType<typeof makeRedisMock>;

  beforeEach(async () => {
    redis = makeRedisMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DistributedLockService,
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();
    service = module.get(DistributedLockService);
  });

  // ── acquire + release ────────────────────────────────────────────────────

  it('acquires lock, runs fn, releases lock', async () => {
    redis.set.mockResolvedValue('OK');
    const fn = jest.fn().mockResolvedValue(undefined);

    const result = await service.withLock('test-key', 60, fn);

    expect(result).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    // Acquire: SET cron:lock:test-key 1 EX 60 NX
    expect(redis.set).toHaveBeenCalledWith('cron:lock:test-key', '1', 'EX', 60, 'NX');
    // Release
    expect(redis.del).toHaveBeenCalledWith('cron:lock:test-key');
  });

  it('skips fn and returns false when lock is busy (another instance holds it)', async () => {
    redis.set.mockResolvedValue(null); // NX not acquired
    const fn = jest.fn();

    const result = await service.withLock('test-key', 60, fn);

    expect(result).toBe(false);
    expect(fn).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('releases lock even when fn throws', async () => {
    redis.set.mockResolvedValue('OK');
    const fn = jest.fn().mockRejectedValue(new Error('fn error'));

    await expect(service.withLock('test-key', 60, fn)).rejects.toThrow('fn error');

    expect(redis.del).toHaveBeenCalledWith('cron:lock:test-key');
  });

  it('uses correct lock key prefix "cron:lock:"', async () => {
    redis.set.mockResolvedValue('OK');
    await service.withLock('my-cron', 30, jest.fn().mockResolvedValue(undefined));

    const [lockKey] = redis.set.mock.calls[0] as [string, ...unknown[]];
    expect(lockKey).toBe('cron:lock:my-cron');
  });

  it('passes ttlSeconds as EX argument', async () => {
    redis.set.mockResolvedValue('OK');
    await service.withLock('ttl-test', 123, jest.fn().mockResolvedValue(undefined));

    const args = redis.set.mock.calls[0] as unknown[];
    // SET key value EX ttl NX
    expect(args[2]).toBe('EX');
    expect(args[3]).toBe(123);
    expect(args[4]).toBe('NX');
  });

  // ── Redis unavailable (fail-open) ────────────────────────────────────────

  it('runs fn when Redis SET throws (fail-open: prefer double-run over silent skip)', async () => {
    redis.set.mockRejectedValue(new Error('Redis connection refused'));
    const fn = jest.fn().mockResolvedValue(undefined);

    const result = await service.withLock('test-key', 60, fn);

    expect(result).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    // Lock was never acquired so DEL should not be called
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('propagates fn error even in fail-open path', async () => {
    redis.set.mockRejectedValue(new Error('Redis down'));
    const fn = jest.fn().mockRejectedValue(new Error('fn also failed'));

    await expect(service.withLock('test-key', 60, fn)).rejects.toThrow('fn also failed');
  });

  // ── DEL failure is non-critical ─────────────────────────────────────────

  it('does not throw when DEL fails after fn completes (TTL will expire the lock)', async () => {
    redis.set.mockResolvedValue('OK');
    redis.del.mockRejectedValue(new Error('Redis DEL failed'));
    const fn = jest.fn().mockResolvedValue(undefined);

    await expect(service.withLock('test-key', 60, fn)).resolves.toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // ── Heartbeat: lock TTL is renewed while fn is running ───────────────────

  describe('heartbeat', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('renews lock TTL via EXPIRE every ttl/2 seconds while fn is running', async () => {
      redis.set.mockResolvedValue('OK');

      let resolveF!: () => void;
      const fn = jest.fn().mockReturnValue(new Promise<void>(r => { resolveF = r; }));

      const lockPromise = service.withLock('test-key', 60, fn);

      // First heartbeat fires at 30s (ttl/2 = 30)
      await jest.advanceTimersByTimeAsync(30_000);
      expect(redis.expire).toHaveBeenCalledTimes(1);
      expect(redis.expire).toHaveBeenCalledWith('cron:lock:test-key', 60);

      // Second heartbeat fires at 60s
      await jest.advanceTimersByTimeAsync(30_000);
      expect(redis.expire).toHaveBeenCalledTimes(2);

      // Complete fn — heartbeat must stop
      resolveF();
      await lockPromise;

      // No more EXPIRE calls after fn finishes
      await jest.advanceTimersByTimeAsync(60_000);
      expect(redis.expire).toHaveBeenCalledTimes(2);
      expect(redis.del).toHaveBeenCalledWith('cron:lock:test-key');
    });

    it('clears heartbeat when fn throws', async () => {
      redis.set.mockResolvedValue('OK');

      let rejectF!: (e: Error) => void;
      const fn = jest.fn().mockReturnValue(new Promise<void>((_, r) => { rejectF = r; }));

      const lockPromise = service.withLock('test-key', 60, fn);

      await jest.advanceTimersByTimeAsync(30_000);
      expect(redis.expire).toHaveBeenCalledTimes(1);

      rejectF(new Error('fn error'));
      await expect(lockPromise).rejects.toThrow('fn error');

      // Heartbeat is cleared — no more renewals
      await jest.advanceTimersByTimeAsync(60_000);
      expect(redis.expire).toHaveBeenCalledTimes(1);
      expect(redis.del).toHaveBeenCalledWith('cron:lock:test-key');
    });

    it('does not start heartbeat when lock is busy', async () => {
      redis.set.mockResolvedValue(null); // lock busy
      const fn = jest.fn();

      await service.withLock('test-key', 60, fn);

      await jest.advanceTimersByTimeAsync(30_000);
      expect(redis.expire).not.toHaveBeenCalled();
    });
  });

  // ── Isolation: different keys don't interfere ────────────────────────────

  it('different lock keys are independent', async () => {
    redis.set
      .mockResolvedValueOnce('OK')  // key-a acquired
      .mockResolvedValueOnce(null); // key-b busy
    const fnA = jest.fn().mockResolvedValue(undefined);
    const fnB = jest.fn().mockResolvedValue(undefined);

    const [resultA, resultB] = await Promise.all([
      service.withLock('key-a', 60, fnA),
      service.withLock('key-b', 60, fnB),
    ]);

    expect(resultA).toBe(true);
    expect(resultB).toBe(false);
    expect(fnA).toHaveBeenCalledTimes(1);
    expect(fnB).not.toHaveBeenCalled();
  });
});
