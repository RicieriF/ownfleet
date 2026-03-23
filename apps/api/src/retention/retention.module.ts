import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { RetentionService } from './retention.service.js';
import { ShiftsModule } from '../shifts/shifts.module.js';

@Module({
  imports: [ScheduleModule.forRoot(), ShiftsModule],
  providers: [RetentionService],
})
export class RetentionModule {}
