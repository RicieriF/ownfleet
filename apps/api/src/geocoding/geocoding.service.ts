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
}

interface NominatimResult {
  lat: string;
  lon: string;
}

const CACHE_TTL_SECONDS = 30 * 24 * 3600; // 30 days
const NEGATIVE_CACHE_TTL_SECONDS = 3600; // 1 hour for unresolvable addresses

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
      config.get<string>('NOMINATIM_URL') ?? 'https://nominatim.openstreetmap.org';
  }

  /**
   * Enqueues a geocoding job for an order that has no coordinates.
   * Fire-and-forget safe: errors are logged, not rethrown.
   * Skips unknown or empty addresses.
   */
  async enqueueGeocode(orderId: string, address: string): Promise<void> {
    if (!address || address.trim() === '' || address === 'Unknown') return;
    try {
      await this.queue.add({ orderId, address }, { jobId: orderId });
    } catch (err) {
      this.logger.warn(`Failed to enqueue geocoding for order ${orderId}`, err);
    }
  }

  /**
   * Resolves an address to coordinates via Nominatim with Redis caching.
   * Returns null on timeout (2s), HTTP error, or empty result.
   * Never throws — callers can treat null as "no coords available".
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
        headers: { 'User-Agent': 'weego-cmi/1.0 (https://weego.app)' },
      });
      clearTimeout(timer);

      if (!res.ok) {
        this.logger.warn(`Nominatim HTTP ${res.status} for address: ${address}`);
        return null;
      }

      const data = (await res.json()) as NominatimResult[];
      if (!data[0]) {
        await this.redis.set(cacheKey, 'null', 'EX', NEGATIVE_CACHE_TTL_SECONDS);
        return null;
      }

      const lat = parseFloat(data[0].lat);
      const lng = parseFloat(data[0].lon);
      if (isNaN(lat) || isNaN(lng)) return null;

      const result = { lat, lng };
      await this.redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL_SECONDS);
      return result;
    } catch (err: unknown) {
      clearTimeout(timer);
      if ((err as Error)?.name === 'AbortError') {
        this.logger.warn(`Nominatim timeout (2s) for address: ${address}`);
      } else {
        this.logger.warn(`Nominatim error for address: ${address}`, err);
      }
      return null;
    }
  }
}
