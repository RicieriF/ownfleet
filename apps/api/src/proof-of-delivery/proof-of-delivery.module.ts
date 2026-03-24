import { Module } from '@nestjs/common';
import { ProofOfDeliveryController } from './proof-of-delivery.controller.js';
import { ProofOfDeliveryService } from './proof-of-delivery.service.js';
import { EstablishmentsModule } from '../establishments/establishments.module.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';
import { ShiftsModule } from '../shifts/shifts.module.js';
import { ShiftActiveGuard } from '../shifts/guards/shift-active.guard.js';
import { TelegramModule } from '../telegram/telegram.module.js';

@Module({
  imports: [EstablishmentsModule, WebhooksModule, ShiftsModule, TelegramModule],
  controllers: [ProofOfDeliveryController],
  providers: [ProofOfDeliveryService, ShiftActiveGuard],
})
export class ProofOfDeliveryModule {}
