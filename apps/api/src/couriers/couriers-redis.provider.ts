import { Inject } from '@nestjs/common';

export const COURIERS_REDIS_CLIENT = 'COURIERS_REDIS_CLIENT';

export const InjectCouriersRedis = (): ParameterDecorator => Inject(COURIERS_REDIS_CLIENT);
