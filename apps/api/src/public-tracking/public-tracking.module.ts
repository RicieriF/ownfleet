import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { PublicTrackingController } from './public-tracking.controller.js';
import { PublicTrackingService } from './public-tracking.service.js';
import { PublicTrackingGateway } from './public-tracking.gateway.js';
import { ApiKeyGuard } from './guards/api-key.guard.js';
import { ApiKeysModule } from '../api-keys/api-keys.module.js';
import { TRACKING_DISCONNECT_QUEUE } from './public-tracking.constants.js';

// Redis (REDIS_CLIENT + RedisSubscriberFactory) is provided globally by SharedRedisModule
// ScheduleModule.forRoot() is registered by RetentionModule and applies globally — no need to import here

@Module({
  imports: [
    BullModule.registerQueue({
      name: TRACKING_DISCONNECT_QUEUE,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 50,
      },
    }),
    ApiKeysModule,
  ],
  controllers: [PublicTrackingController],
  providers: [PublicTrackingService, PublicTrackingGateway, ApiKeyGuard],
  exports: [PublicTrackingService],
})
export class PublicTrackingModule {}
