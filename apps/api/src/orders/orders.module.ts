import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { EstablishmentsModule } from '../establishments/establishments.module.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';
import { TelegramModule } from '../telegram/telegram.module.js';
import { EtaModule } from '../eta/eta.module.js';

@Module({
  imports: [EstablishmentsModule, WebhooksModule, TelegramModule, EtaModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
