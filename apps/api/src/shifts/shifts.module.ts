import { Module } from '@nestjs/common';
import { ShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EstablishmentsModule } from '../establishments/establishments.module';
import { TrackingModule } from '../tracking/tracking.module';
import { TelegramModule } from '../telegram/telegram.module.js';

@Module({
  imports: [PrismaModule, EstablishmentsModule, TrackingModule, TelegramModule],
  controllers: [ShiftsController],
  providers: [ShiftsService],
  exports: [ShiftsService], // exported for ShiftActiveGuard in other modules
})
export class ShiftsModule {}
