import { Module } from '@nestjs/common';
import { ShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EstablishmentsModule } from '../establishments/establishments.module';

@Module({
  imports: [PrismaModule, EstablishmentsModule],
  controllers: [ShiftsController],
  providers: [ShiftsService],
  exports: [ShiftsService], // exported for ShiftActiveGuard in other modules
})
export class ShiftsModule {}
