import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PING_PERSIST_QUEUE } from '../tracking/tracking.service.js';
import { WEBHOOK_QUEUE } from '../webhooks/webhooks.service.js';
import { GEOCODING_QUEUE } from '../geocoding/geocoding.constants.js';
import { TRACKING_DISCONNECT_QUEUE } from '../public-tracking/public-tracking.constants.js';
import { MetricsService } from './metrics.service.js';
import { MetricsController } from './metrics.controller.js';
import { MetricsInterceptor } from './metrics.interceptor.js';

@Module({
  imports: [
    // NestJS deduplicates queue registrations by name — safe to register here
    // even though the same queues are registered in their respective modules.
    BullModule.registerQueue(
      { name: PING_PERSIST_QUEUE },
      { name: WEBHOOK_QUEUE },
      { name: 'dispatch' },
      { name: GEOCODING_QUEUE },
      { name: TRACKING_DISCONNECT_QUEUE },
    ),
  ],
  controllers: [MetricsController],
  providers: [
    MetricsService,
    // APP_INTERCEPTOR applies globally — records HTTP durations for all routes.
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
  ],
  exports: [MetricsService],
})
export class MetricsModule {}
