import { Module } from '@nestjs/common';
import { TransportService } from './transport.service.js';

@Module({
  providers: [TransportService],
  exports: [TransportService],
})
export class TransportModule {}
