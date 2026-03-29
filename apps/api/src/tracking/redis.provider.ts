import { Inject } from '@nestjs/common';
import { REDIS_CLIENT } from '../shared/redis/redis.constants.js';

// Re-export shared constant so TrackingService can use @InjectRedis() decorator
export { REDIS_CLIENT };

export const InjectRedis = (): ParameterDecorator => Inject(REDIS_CLIENT);
