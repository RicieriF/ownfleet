import { Module, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { CouriersController } from './couriers.controller.js';
import { CouriersService } from './couriers.service.js';
import { EstablishmentsModule } from '../establishments/establishments.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { TelegramModule } from '../telegram/telegram.module.js';
import { COURIERS_REDIS_CLIENT } from './couriers-redis.provider.js';

@Module({
  imports: [EstablishmentsModule, NotificationsModule, TelegramModule],
  controllers: [CouriersController],
  providers: [
    CouriersService,
    {
      provide: COURIERS_REDIS_CLIENT,
      useFactory: (config: ConfigService) => {
        const logger = new Logger('CouriersRedisClient');
        const client = new Redis(config.getOrThrow<string>('REDIS_URL'));
        client.on('error', (err) => logger.error('Couriers Redis error', err));
        return client;
      },
      inject: [ConfigService],
    },
  ],
  exports: [CouriersService],
})
export class CouriersModule {}
