import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';
import { RetentionService } from './retention.service.js';
import { ShiftsModule } from '../shifts/shifts.module.js';
import { EtaModule } from '../eta/eta.module.js';
import { TelegramModule } from '../telegram/telegram.module.js';
import { GeocodingModule } from '../geocoding/geocoding.module.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    BullModule.registerQueue({ name: 'dispatch' }),
    ShiftsModule,
    EtaModule,
    TelegramModule,
    GeocodingModule,
  ],
  providers: [RetentionService],
})
export class RetentionModule {}
