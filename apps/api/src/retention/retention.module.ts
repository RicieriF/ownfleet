import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { RetentionService } from './retention.service.js';
import { ShiftsModule } from '../shifts/shifts.module.js';
import { EtaModule } from '../eta/eta.module.js';

@Module({
  imports: [ScheduleModule.forRoot(), ShiftsModule, EtaModule],
  providers: [RetentionService],
})
export class RetentionModule {}
