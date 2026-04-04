import { Test } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bull';
import { HealthController } from '../health.controller.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../shared/redis/redis.constants.js';
import { PING_PERSIST_QUEUE } from '../../tracking/tracking.service.js';
import { WEBHOOK_QUEUE } from '../../webhooks/webhooks.service.js';

const mockPrisma = {
  $queryRaw: jest.fn(),
};

const mockRedis = {
  ping: jest.fn(),
};

const mockPingQueue = {
  isPaused: jest.fn(),
};

const mockWebhookQueue = {
  isPaused: jest.fn(),
};

async function buildController(): Promise<HealthController> {
  const module = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [
      { provide: PrismaService, useValue: mockPrisma },
      { provide: REDIS_CLIENT, useValue: mockRedis },
      { provide: getQueueToken(PING_PERSIST_QUEUE), useValue: mockPingQueue },
      { provide: getQueueToken(WEBHOOK_QUEUE), useValue: mockWebhookQueue },
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

  it('returns status=ok when all checks pass', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    mockRedis.ping.mockResolvedValue('PONG');
    mockPingQueue.isPaused.mockResolvedValue(false);
    mockWebhookQueue.isPaused.mockResolvedValue(false);

    const result = await controller.check();

    expect(result.status).toBe('ok');
    expect(result.services.database).toBe('ok');
    expect(result.services.redis).toBe('ok');
    expect(result.services.queues[PING_PERSIST_QUEUE]).toBe('ok');
    expect(result.services.queues[WEBHOOK_QUEUE]).toBe('ok');
    expect(result.services.version).toBeDefined();
    expect(result.timestamp).toBeDefined();
  });

  it('throws 503 when DB is down', async () => {
    mockPrisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
    mockRedis.ping.mockResolvedValue('PONG');
    mockPingQueue.isPaused.mockResolvedValue(false);
    mockWebhookQueue.isPaused.mockResolvedValue(false);

    await expect(controller.check()).rejects.toThrow(ServiceUnavailableException);
  });

  it('throws 503 when Redis is down', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockRedis.ping.mockRejectedValue(new Error('redis timeout'));
    mockPingQueue.isPaused.mockResolvedValue(false);
    mockWebhookQueue.isPaused.mockResolvedValue(false);

    await expect(controller.check()).rejects.toThrow(ServiceUnavailableException);
  });

  it('throws 503 when both DB and Redis are down', async () => {
    mockPrisma.$queryRaw.mockRejectedValue(new Error('db down'));
    mockRedis.ping.mockRejectedValue(new Error('redis down'));
    mockPingQueue.isPaused.mockResolvedValue(false);
    mockWebhookQueue.isPaused.mockResolvedValue(false);

    await expect(controller.check()).rejects.toThrow(ServiceUnavailableException);
  });

  it('throws 503 with per-service status in response body', async () => {
    mockPrisma.$queryRaw.mockRejectedValue(new Error('db down'));
    mockRedis.ping.mockResolvedValue('PONG');
    mockPingQueue.isPaused.mockResolvedValue(false);
    mockWebhookQueue.isPaused.mockResolvedValue(false);

    let thrown: ServiceUnavailableException | null = null;
    try {
      await controller.check();
    } catch (err) {
      thrown = err as ServiceUnavailableException;
    }

    expect(thrown).not.toBeNull();
    const body = thrown!.getResponse() as Record<string, unknown>;
    expect(body['status']).toBe('error');
    const services = body['services'] as Record<string, unknown>;
    expect(services['database']).toBe('error');
    expect(services['redis']).toBe('ok');
  });

  it('treats non-PONG redis response as failure', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockRedis.ping.mockResolvedValue('WRONGVAL');
    mockPingQueue.isPaused.mockResolvedValue(false);
    mockWebhookQueue.isPaused.mockResolvedValue(false);

    await expect(controller.check()).rejects.toThrow(ServiceUnavailableException);
  });

  it('throws 503 when ping-persist queue is paused', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockRedis.ping.mockResolvedValue('PONG');
    mockPingQueue.isPaused.mockResolvedValue(true);
    mockWebhookQueue.isPaused.mockResolvedValue(false);

    let thrown: ServiceUnavailableException | null = null;
    try {
      await controller.check();
    } catch (err) {
      thrown = err as ServiceUnavailableException;
    }

    expect(thrown).not.toBeNull();
    const body = thrown!.getResponse() as Record<string, unknown>;
    const services = body['services'] as Record<string, unknown>;
    const queues = services['queues'] as Record<string, string>;
    expect(queues[PING_PERSIST_QUEUE]).toBe('paused');
  });

  it('throws 503 when webhook-dispatch queue is paused', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockRedis.ping.mockResolvedValue('PONG');
    mockPingQueue.isPaused.mockResolvedValue(false);
    mockWebhookQueue.isPaused.mockResolvedValue(true);

    await expect(controller.check()).rejects.toThrow(ServiceUnavailableException);
  });

  it('reports queue as error when isPaused() throws', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockRedis.ping.mockResolvedValue('PONG');
    mockPingQueue.isPaused.mockRejectedValue(new Error('queue unreachable'));
    mockWebhookQueue.isPaused.mockResolvedValue(false);

    let thrown: ServiceUnavailableException | null = null;
    try {
      await controller.check();
    } catch (err) {
      thrown = err as ServiceUnavailableException;
    }

    expect(thrown).not.toBeNull();
    const body = thrown!.getResponse() as Record<string, unknown>;
    const services = body['services'] as Record<string, unknown>;
    const queues = services['queues'] as Record<string, string>;
    expect(queues[PING_PERSIST_QUEUE]).toBe('error');
  });
});
