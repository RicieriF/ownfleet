import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { RetentionService } from './retention.service.js';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [RetentionService],
})
export class RetentionModule {}
