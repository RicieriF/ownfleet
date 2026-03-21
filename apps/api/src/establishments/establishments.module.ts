import { Module } from '@nestjs/common';
import { EstablishmentsController } from './establishments.controller.js';
import { EstablishmentsService } from './establishments.service.js';
import { PlanAccessGuard } from './guards/plan-access.guard.js';

@Module({
  controllers: [EstablishmentsController],
  providers: [EstablishmentsService, PlanAccessGuard],
  exports: [PlanAccessGuard],
})
export class EstablishmentsModule {}
