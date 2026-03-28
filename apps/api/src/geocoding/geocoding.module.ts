import { Module, Logger } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { GeocodingService } from './geocoding.service.js';
import { GeocodingProcessor } from './processors/geocoding.processor.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { GEOCODING_QUEUE, GEOCODING_REDIS_CLIENT } from './geocoding.constants.js';

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue({
      name: GEOCODING_QUEUE,
      limiter: { max: 1, duration: 1000 }, // 1 Nominatim req/s
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
      },
    }),
  ],
  providers: [
    GeocodingService,
    GeocodingProcessor,
    {
      provide: GEOCODING_REDIS_CLIENT,
      useFactory: (config: ConfigService) => {
        const logger = new Logger('GeocodingRedisClient');
        const client = new Redis(config.getOrThrow<string>('REDIS_URL'));
        client.on('error', (err) => logger.error('Geocoding Redis error', err));
        return client;
      },
      inject: [ConfigService],
    },
  ],
  exports: [GeocodingService],
})
export class GeocodingModule {}
