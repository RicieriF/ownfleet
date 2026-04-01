import { Logger, Inject } from '@nestjs/common';
import { Processor, Process } from '@nestjs/bull';
import type { Job } from 'bull';
import type IORedis from 'ioredis';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { GeocodingService, GeocodeJob } from '../geocoding.service.js';
import { GEOCODING_QUEUE } from '../geocoding.constants.js';
import { REDIS_CLIENT } from '../../shared/redis/redis.constants.js';

export const GEOCODING_DONE_CHANNEL = 'geocoding:done';

export interface GeocodingDonePayload {
  orderId: string;
  lat: number;
  lng: number;
}

@Processor(GEOCODING_QUEUE)
export class GeocodingProcessor {
  private readonly logger = new Logger(GeocodingProcessor.name);

  constructor(
    private readonly geocodingService: GeocodingService,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
  ) {}

  @Process()
  async handle(job: Job<GeocodeJob>): Promise<void> {
    const { orderId, address } = job.data;

    const coords = await this.geocodingService.geocode(address);
    if (!coords) {
      this.logger.warn(`Geocoding returned null for order ${orderId}, address: "${address}"`);
      return; // order stays with lat=null; no Redis event
    }

    try {
      await this.prisma.order.update({
        where: { id: orderId },
        data: { lat: coords.lat, lng: coords.lng },
      });
    } catch (err) {
      // P2025: order was deleted (e.g. by retention) between enqueue and processing — skip silently
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        this.logger.warn(`Geocoding skipped — order ${orderId} no longer exists`);
        return;
      }
      throw err;
    }

    const payload: GeocodingDonePayload = { orderId, lat: coords.lat, lng: coords.lng };
    await this.redis.publish(GEOCODING_DONE_CHANNEL, JSON.stringify(payload));

    this.logger.log(`Geocoded order ${orderId}: ${coords.lat},${coords.lng}`);
  }
}
