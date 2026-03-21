import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { WebhooksController } from './webhooks.controller.js';
import { WebhooksService, WEBHOOK_QUEUE } from './webhooks.service.js';
import { WebhookDispatchProcessor } from './webhook-dispatch.processor.js';
import { EstablishmentsModule } from '../establishments/establishments.module.js';

@Module({
  imports: [
    EstablishmentsModule,
    BullModule.registerQueue({ name: WEBHOOK_QUEUE }),
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookDispatchProcessor],
  exports: [WebhooksService], // other modules call dispatch()
})
export class WebhooksModule {}
