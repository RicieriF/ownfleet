import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { EstablishmentsModule } from '../establishments/establishments.module.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';
import { TelegramModule } from '../telegram/telegram.module.js';
import { EtaModule } from '../eta/eta.module.js';
import { TrackingModule } from '../tracking/tracking.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { CouriersModule } from '../couriers/couriers.module.js';

@Module({
  imports: [EstablishmentsModule, WebhooksModule, TelegramModule, EtaModule, TrackingModule, NotificationsModule, CouriersModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
