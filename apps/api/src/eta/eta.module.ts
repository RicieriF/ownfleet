import { Module } from '@nestjs/common';
import { EtaService } from './eta.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { TelegramModule } from '../telegram/telegram.module.js';

@Module({
  imports: [PrismaModule, TelegramModule],
  providers: [EtaService],
  exports: [EtaService],
})
export class EtaModule {}
