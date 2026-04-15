import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';

@Injectable()
export class RedisSubscriberFactory {
  private readonly logger = new Logger(RedisSubscriberFactory.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Creates a dedicated IORedis connection for pub/sub subscriptions.
   * IORedis requires a separate connection per subscriber (cannot issue
   * regular commands on a connection that is in subscribe mode).
   */
  create(): IORedis {
    const client = new IORedis(this.config.getOrThrow<string>('REDIS_URL'));
    client.on('error', (err) =>
      this.logger.error('Redis subscriber connection error', err),
    );
    return client;
  }
}
