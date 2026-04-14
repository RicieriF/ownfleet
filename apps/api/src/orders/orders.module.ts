import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { DispatchProcessor } from './dispatch.processor.js';
import { DispatchService } from './dispatch.service.js';
import { EstablishmentsModule } from '../establishments/establishments.module.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';
import { TelegramModule } from '../telegram/telegram.module.js';
import { EtaModule } from '../eta/eta.module.js';
import { TrackingModule } from '../tracking/tracking.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { CouriersModule } from '../couriers/couriers.module.js';
import { GeocodingModule } from '../geocoding/geocoding.module.js';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'dispatch',
      defaultJobOptions: { removeOnComplete: true, removeOnFail: true },
    }),
    EstablishmentsModule,
    WebhooksModule,
    TelegramModule,
    EtaModule,
    TrackingModule,
    NotificationsModule,
    CouriersModule,
    GeocodingModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService, DispatchProcessor, DispatchService],
  exports: [OrdersService],
})
export class OrdersModule {}
