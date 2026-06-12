import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bull';
import type IORedis from 'ioredis';
import * as crypto from 'node:crypto';
import { GEOCODING_QUEUE } from './geocoding.constants.js';
import { REDIS_CLIENT } from '../shared/redis/redis.constants.js';

export interface GeocodeJob {
  orderId: string;
  address: string;
  establishmentId: string;
}

interface NominatimResult {
  lat: string;
  lon: string;
  importance?: number;
}

/**
 * Minimum Nominatim importance score to accept a geocoding result.
 * Importance is 0–1: country ≈ 0.0–0.2, city ≈ 0.2–0.5, street ≈ 0.5+, building ≈ 0.7+.
 * Results below this threshold are too coarse (city/district-level) and should not be
 * used as delivery coordinates — they could be hundreds of meters off.
 */
const MIN_IMPORTANCE = 0.25;

const CACHE_TTL_SECONDS = 30 * 24 * 3600; // 30 days
// 10 minutes: short enough that the recovery cron (every 30 min) always gets a fresh
// Nominatim attempt rather than hitting the stale negative cache.
const NEGATIVE_CACHE_TTL_SECONDS = 600;

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  private readonly nominatimUrl: string;

  constructor(
    @InjectQueue(GEOCODING_QUEUE) private readonly queue: Queue<GeocodeJob>,
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
    config: ConfigService,
  ) {
    this.nominatimUrl =
      config.get<string>('NOMINATIM_URL') ??
      'https://nominatim.openstreetmap.org';
  }

  /**
   * Enqueues a geocoding job for an order that has no coordinates.
   * Fire-and-forget safe: errors are logged, not rethrown.
   * Skips unknown or empty addresses.
   * establishmentId is used by the processor to look up the establishment city
   * and append it to the Nominatim query for city-scoped geocoding accuracy.
   */
  async enqueueGeocode(
    orderId: string,
    address: string,
    establishmentId: string,
  ): Promise<void> {
    if (!address || address.trim() === '' || address === 'Unknown') return;
    try {
      await this.queue.add(
        { orderId, address, establishmentId },
        { jobId: orderId },
      );
    } catch (err) {
      this.logger.warn(`Failed to enqueue geocoding for order ${orderId}`, err);
    }
  }

  /**
   * Resolves an address to coordinates via Nominatim with Redis caching.
   * Returns null when address is not found (empty result) or importance is too low.
   * Throws on transient failures (HTTP error, timeout, network) so Bull retries the job.
   */
  async geocode(address: string): Promise<{ lat: number; lng: number } | null> {
    const cacheKey = `geocode:${crypto
      .createHash('sha256')
      .update(address.toLowerCase().trim())
      .digest('hex')}`;

    const cached = await this.redis.get(cacheKey);
    if (cached === 'null') return null; // negative cache hit
    if (cached) {
      return JSON.parse(cached) as { lat: number; lng: number };
    }

    const url = `${this.nominatimUrl}/search?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=ua`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'ownfleet/1.0 (https://ownfleet.app)' },
      });
      clearTimeout(timer);

      if (!res.ok) {
        // Transient server-side error — let Bull retry (attempts: 3)
        throw new Error(`Nominatim HTTP ${res.status} for address: ${address}`);
      }

      const data = (await res.json()) as NominatimResult[];
      if (!data[0]) {
        await this.redis.set(
          cacheKey,
          'null',
          'EX',
          NEGATIVE_CACHE_TTL_SECONDS,
        );
        return null;
      }

      const lat = parseFloat(data[0].lat);
      const lng = parseFloat(data[0].lon);
      if (isNaN(lat) || isNaN(lng)) return null;

      // Reject results that are too coarse (city/region level) — they are not usable
      // as delivery coordinates. No negative cache: a fresh retry may yield a better
      // match as OSM coverage improves or the query varies.
      const importance = data[0].importance ?? 1;
      if (importance < MIN_IMPORTANCE) {
        this.logger.warn(
          `Nominatim low-importance result (${importance.toFixed(2)}) for address: ${address} — skipping`,
        );
        return null;
      }

      const result = { lat, lng };
      await this.redis.set(
        cacheKey,
        JSON.stringify(result),
        'EX',
        CACHE_TTL_SECONDS,
      );
      return result;
    } catch (err: unknown) {
      clearTimeout(timer);
      if ((err as Error)?.name === 'AbortError') {
        // Transient timeout — let Bull retry (attempts: 3)
        throw new Error(`Nominatim timeout (2s) for address: ${address}`);
      }
      // Propagate all other errors (network failure, unexpected) for Bull retry
      throw err;
    }
  }
}
