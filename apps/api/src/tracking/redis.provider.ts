import { Inject } from '@nestjs/common';

export const REDIS_CLIENT = 'REDIS_CLIENT';
export const REDIS_SUBSCRIBER = 'REDIS_SUBSCRIBER';

export const InjectRedis = (): ParameterDecorator => Inject(REDIS_CLIENT);
export const InjectRedisSubscriber = (): ParameterDecorator => Inject(REDIS_SUBSCRIBER);
