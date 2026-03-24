import { Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const TELEGRAM_REDIS = 'TELEGRAM_REDIS_CLIENT';
export const CONNECT_CODE_TTL_SEC = 600; // 10 minutes

export const telegramRedisProvider = {
  provide: TELEGRAM_REDIS,
  useFactory: (config: ConfigService) => {
    const logger = new Logger('TelegramRedis');
    const client = new Redis(config.getOrThrow<string>('REDIS_URL'));
    client.on('error', (err) => logger.error('Telegram Redis error', err));
    return client;
  },
  inject: [ConfigService],
};
