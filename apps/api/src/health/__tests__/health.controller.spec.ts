import { Test } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from '../health.controller.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../shared/redis/redis.constants.js';

const mockPrisma = {
  $queryRaw: jest.fn(),
};

const mockRedis = {
  ping: jest.fn(),
};

async function buildController(): Promise<HealthController> {
  const module = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [
      { provide: PrismaService, useValue: mockPrisma },
      { provide: REDIS_CLIENT, useValue: mockRedis },
    ],
  }).compile();

  return module.get(HealthController);
}

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    jest.clearAllMocks();
    controller = await buildController();
  });

  it('returns status=ok with services.database=ok and services.redis=ok when both healthy', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    mockRedis.ping.mockResolvedValue('PONG');

    const result = await controller.check();

    expect(result.status).toBe('ok');
    expect(result.services.database).toBe('ok');
    expect(result.services.redis).toBe('ok');
    expect(result.timestamp).toBeDefined();
  });

  it('throws 503 when DB is down', async () => {
    mockPrisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
    mockRedis.ping.mockResolvedValue('PONG');

    await expect(controller.check()).rejects.toThrow(ServiceUnavailableException);
  });

  it('throws 503 when Redis is down', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockRedis.ping.mockRejectedValue(new Error('redis timeout'));

    await expect(controller.check()).rejects.toThrow(ServiceUnavailableException);
  });

  it('throws 503 when both DB and Redis are down', async () => {
    mockPrisma.$queryRaw.mockRejectedValue(new Error('db down'));
    mockRedis.ping.mockRejectedValue(new Error('redis down'));

    await expect(controller.check()).rejects.toThrow(ServiceUnavailableException);
  });

  it('503 response body contains per-service error status', async () => {
    mockPrisma.$queryRaw.mockRejectedValue(new Error('db down'));
    mockRedis.ping.mockResolvedValue('PONG');

    let thrown: ServiceUnavailableException | null = null;
    try {
      await controller.check();
    } catch (err) {
      thrown = err as ServiceUnavailableException;
    }

    expect(thrown).not.toBeNull();
    const body = thrown!.getResponse() as Record<string, unknown>;
    expect(body['status']).toBe('error');
    const services = body['services'] as Record<string, string>;
    expect(services['database']).toBe('error');
    expect(services['redis']).toBe('ok');
  });

  it('treats non-PONG redis response as failure', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockRedis.ping.mockResolvedValue('WRONGVAL');

    await expect(controller.check()).rejects.toThrow(ServiceUnavailableException);
  });
});
