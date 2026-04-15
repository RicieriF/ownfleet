import { Injectable, Logger, Inject } from '@nestjs/common';
import type IORedis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants.js';

@Injectable()
export class DistributedLockService {
  private readonly logger = new Logger(DistributedLockService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: IORedis) {}

  /**
   * Tries to acquire a Redis distributed lock (SET NX EX) and execute fn.
   *
   * - If the lock is busy (another instance is running the same cron), fn is skipped silently.
   * - The lock is released explicitly via DEL on completion (success or error).
   * - A heartbeat renews the lock TTL every ttl/2 seconds while fn is running, so the lock
   *   never expires mid-execution on a live process regardless of how long fn takes.
   * - TTL is a crash-recovery safety net: if the process dies, the heartbeat stops and
   *   the lock expires automatically after at most ttlSeconds.
   * - If Redis is unavailable: fail-open — fn runs anyway (accept possible double-run rather than
   *   silently dropping critical work like shift auto-close or Telegram notifications).
   *
   * @param key        Unique lock name (prefixed with "cron:lock:" internally).
   * @param ttlSeconds Crash-recovery TTL. Choose a value large enough to survive a full restart
   *                   cycle without blocking other instances for too long (e.g. 2× expected runtime).
   * @param fn         The async work to execute under the lock.
   * @returns true if fn was executed, false if lock was busy.
   */
  async withLock(
    key: string,
    ttlSeconds: number,
    fn: () => Promise<void>,
  ): Promise<boolean> {
    const lockKey = `cron:lock:${key}`;
    let acquired: string | null;

    try {
      // SET NX EX: atomic acquire — returns 'OK' on success, null if already set.
      acquired = await this.redis.set(lockKey, '1', 'EX', ttlSeconds, 'NX');
    } catch (err) {
      // Redis unavailable — fail open: run fn so critical cron work is not silently lost.
      this.logger.warn(
        `Failed to acquire lock for "${key}" (Redis error) — running anyway`,
        err,
      );
      await fn();
      return true;
    }

    if (acquired === null) {
      this.logger.debug(`Cron lock busy, skipping: "${key}"`);
      return false;
    }

    // Heartbeat: renew lock TTL every ttl/2 seconds so a slow-but-alive fn never loses the lock.
    const heartbeatMs = Math.floor(ttlSeconds / 2) * 1000;
    const heartbeat = setInterval(() => {
      this.redis
        .expire(lockKey, ttlSeconds)
        .catch((err: unknown) =>
          this.logger.warn(`Failed to renew lock "${key}"`, err),
        );
    }, heartbeatMs);

    try {
      await fn();
      return true;
    } finally {
      clearInterval(heartbeat);
      // Release the lock. Fire-and-forget: a DEL failure is non-critical
      // (lock expires via TTL), but log it for observability.
      this.redis
        .del(lockKey)
        .catch((err: unknown) =>
          this.logger.warn(`Failed to release lock "${key}"`, err),
        );
    }
  }
}
