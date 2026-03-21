import { Module } from '@nestjs/common';
import { ProofOfDeliveryController } from './proof-of-delivery.controller.js';
import { ProofOfDeliveryService } from './proof-of-delivery.service.js';
import { EstablishmentsModule } from '../establishments/establishments.module.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';

@Module({
  imports: [EstablishmentsModule, WebhooksModule],
  controllers: [ProofOfDeliveryController],
  providers: [ProofOfDeliveryService],
})
export class ProofOfDeliveryModule {}
