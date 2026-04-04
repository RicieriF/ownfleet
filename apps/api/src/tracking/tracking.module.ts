import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { BullModule } from '@nestjs/bull';
import { TrackingController } from './tracking.controller.js';
import { TrackingService, PING_PERSIST_QUEUE } from './tracking.service.js';
import { TrackingGateway } from './tracking.gateway.js';
import { PingPersistProcessor } from './processors/ping-persist.processor.js';
import { EstablishmentsModule } from '../establishments/establishments.module.js';
import { EtaModule } from '../eta/eta.module.js';

// Redis (REDIS_CLIENT + RedisSubscriberFactory) is provided globally by SharedRedisModule in AppModule
@Module({
  imports: [
    EstablishmentsModule,
    EtaModule,
    JwtModule.register({}),
    BullModule.registerQueue({
      name: PING_PERSIST_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    }),
  ],
  controllers: [TrackingController],
  providers: [TrackingService, TrackingGateway, PingPersistProcessor],
  exports: [TrackingService, TrackingGateway],
})
export class TrackingModule {}
