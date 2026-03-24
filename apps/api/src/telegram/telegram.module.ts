import { Module, OnApplicationShutdown, Inject } from '@nestjs/common';
import { TelegramController } from './telegram.controller.js';
import { TelegramService } from './telegram.service.js';
import { telegramRedisProvider, TELEGRAM_REDIS } from './telegram-redis.provider.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import type Redis from 'ioredis';

@Module({
  imports: [PrismaModule],
  controllers: [TelegramController],
  providers: [TelegramService, telegramRedisProvider],
  exports: [TelegramService],
})
export class TelegramModule implements OnApplicationShutdown {
  constructor(@Inject(TELEGRAM_REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown() {
    await this.redis.quit();
  }
}
