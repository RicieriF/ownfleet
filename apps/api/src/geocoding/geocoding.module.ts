import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { GeocodingService } from './geocoding.service.js';
import { GeocodingProcessor } from './processors/geocoding.processor.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { GEOCODING_QUEUE } from './geocoding.constants.js';

// Redis (REDIS_CLIENT) is provided globally by SharedRedisModule in AppModule
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
  providers: [GeocodingService, GeocodingProcessor],
  exports: [GeocodingService],
})
export class GeocodingModule {}
