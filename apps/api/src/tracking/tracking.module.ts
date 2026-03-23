import { Module, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import Redis from 'ioredis';
import { TrackingController } from './tracking.controller.js';
import { TrackingService } from './tracking.service.js';
import { TrackingGateway } from './tracking.gateway.js';
import { EstablishmentsModule } from '../establishments/establishments.module.js';
import { REDIS_CLIENT, REDIS_SUBSCRIBER } from './redis.provider.js';

@Module({
  imports: [
    EstablishmentsModule,
    JwtModule.register({}),
  ],
  controllers: [TrackingController],
  providers: [
    TrackingService,
    TrackingGateway,
    {
      provide: REDIS_CLIENT,
      useFactory: (config: ConfigService) => {
        const logger = new Logger('RedisClient');
        const client = new Redis(config.getOrThrow<string>('REDIS_URL'));
        client.on('error', (err) => logger.error('Redis pub error', err));
        return client;
      },
      inject: [ConfigService],
    },
    {
      provide: REDIS_SUBSCRIBER,
      useFactory: (config: ConfigService) => {
        const logger = new Logger('RedisSubscriber');
        const sub = new Redis(config.getOrThrow<string>('REDIS_URL'));
        sub.on('error', (err) => logger.error('Redis sub error', err));
        return sub;
      },
      inject: [ConfigService],
    },
  ],
  exports: [TrackingService, TrackingGateway],
})
export class TrackingModule {}
