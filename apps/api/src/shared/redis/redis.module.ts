import { Global, Module, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants.js';
import { RedisSubscriberFactory } from './redis-subscriber.factory.js';
import { DistributedLockService } from './distributed-lock.service.js';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (config: ConfigService) => {
        const logger = new Logger('SharedRedisClient');
        const client = new IORedis(config.getOrThrow<string>('REDIS_URL'));
        client.on('error', (err) => logger.error('Redis client error', err));
        return client;
      },
      inject: [ConfigService],
    },
    RedisSubscriberFactory,
    DistributedLockService,
  ],
  exports: [REDIS_CLIENT, RedisSubscriberFactory, DistributedLockService],
})
export class SharedRedisModule {}
