import { Module } from '@nestjs/common';
import { TransportController } from './transport.controller.js';
import { TransportService } from './transport.service.js';
import { FamilyTransportController } from './family-transport.controller.js';
import { FamilyTransportService } from './family-transport.service.js';

@Module({
  controllers: [TransportController, FamilyTransportController],
  providers: [TransportService, FamilyTransportService],
  exports: [TransportService, FamilyTransportService],
})
export class TransportModule {}
