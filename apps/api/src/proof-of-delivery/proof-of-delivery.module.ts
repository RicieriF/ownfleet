import { Module } from '@nestjs/common';
import { ProofOfDeliveryController } from './proof-of-delivery.controller.js';
import { ProofOfDeliveryService } from './proof-of-delivery.service.js';
import { EstablishmentsModule } from '../establishments/establishments.module.js';
import { OrdersModule } from '../orders/orders.module.js';

@Module({
  imports: [EstablishmentsModule, OrdersModule],
  controllers: [ProofOfDeliveryController],
  providers: [ProofOfDeliveryService],
})
export class ProofOfDeliveryModule {}
