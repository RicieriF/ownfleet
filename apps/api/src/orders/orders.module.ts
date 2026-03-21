import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { EstablishmentsModule } from '../establishments/establishments.module.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';

@Module({
  imports: [EstablishmentsModule, WebhooksModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
