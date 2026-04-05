import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bull';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { WebhooksService, WEBHOOK_QUEUE } from '../webhooks.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateWebhookDto } from '../dto/create-webhook.dto.js';
import { UpdateWebhookDto } from '../dto/update-webhook.dto.js';

const EST_ID = 'est-1';
const userA: any = { id: 'u1', establishment_id: EST_ID, role: 'manager', is_platform_admin: false };
const dispatcher: any = { id: 'u2', establishment_id: EST_ID, role: 'dispatcher', is_platform_admin: false };

const baseWebhook = {
  id: 'wh-1',
  establishment_id: EST_ID,
  url: 'https://example.com/hook',
  secret: 'my-secret',
  events: ['order.created', 'delivery.completed'],
  active: true,
  consecutive_failures: 0,
  last_error: null,
  last_error_at: null,
};

const mockQueue = { add: jest.fn().mockResolvedValue({}) };
const mockWebhook = {
  create: jest.fn(),
  findMany: jest.fn(),
  findUnique: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};
const mockPrisma = { webhook: mockWebhook };

describe('WebhooksService', () => {
  let service: WebhooksService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: getQueueToken(WEBHOOK_QUEUE), useValue: mockQueue },
      ],
    }).compile();
    service = module.get<WebhooksService>(WebhooksService);
    jest.clearAllMocks();
    mockWebhook.create.mockResolvedValue(baseWebhook);
    mockWebhook.findMany.mockResolvedValue([baseWebhook]);
    mockWebhook.findUnique.mockResolvedValue(baseWebhook);
    mockWebhook.update.mockResolvedValue(baseWebhook);
    mockWebhook.delete.mockResolvedValue(baseWebhook);
  });

  // ── CRUD ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a webhook for the authenticated establishment', async () => {
      const dto = { url: 'https://example.com/hook', secret: 'sec', events: ['order.created'] };
      const result = await service.create(dto, userA);

      expect(mockWebhook.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ establishment_id: EST_ID }),
      });
      expect(result.id).toBeDefined();
    });

    it('throws ForbiddenException for dispatcher role', async () => {
      const dto = { url: 'https://example.com/hook', secret: 'sec', events: ['order.created'] };
      await expect(service.create(dto, dispatcher)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('findAll', () => {
    it('returns only webhooks for the authenticated establishment', async () => {
      const result = await service.findAll(userA);

      expect(mockWebhook.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { establishment_id: EST_ID } }),
      );
      expect(result).toHaveLength(1);
    });
  });

  describe('findOne', () => {
    it('returns webhook for correct establishment', async () => {
      const result = await service.findOne('wh-1', userA);
      expect(result.id).toBe('wh-1');
    });

    it('throws NotFoundException for non-existent webhook', async () => {
      mockWebhook.findUnique.mockResolvedValue(null);
      await expect(service.findOne('missing', userA)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException for webhook from another establishment', async () => {
      mockWebhook.findUnique.mockResolvedValue({ ...baseWebhook, establishment_id: 'est-other' });
      await expect(service.findOne('wh-1', userA)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('update', () => {
    it('updates allowed fields', async () => {
      const result = await service.update('wh-1', { active: false }, userA);
      expect(mockWebhook.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'wh-1' } }),
      );
      expect(result).toBeDefined();
    });

    it('throws ForbiddenException for cross-tenant update', async () => {
      mockWebhook.findUnique.mockResolvedValue({ ...baseWebhook, establishment_id: 'est-other' });
      await expect(service.update('wh-1', { active: false }, userA)).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException for dispatcher role', async () => {
      await expect(service.update('wh-1', { active: false }, dispatcher)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('remove', () => {
    it('deletes the webhook and returns { deleted: true }', async () => {
      const result = await service.remove('wh-1', userA);
      expect(result.deleted).toBe(true);
      expect(mockWebhook.delete).toHaveBeenCalledWith({ where: { id: 'wh-1' } });
    });

    it('throws ForbiddenException for dispatcher role', async () => {
      await expect(service.remove('wh-1', dispatcher)).rejects.toThrow(ForbiddenException);
    });
  });

  // ── dispatch ─────────────────────────────────────────────────────────────

  describe('dispatch', () => {
    it('enqueues a job for each active subscribed webhook', async () => {
      mockWebhook.findMany.mockResolvedValue([{ id: 'wh-1' }, { id: 'wh-2' }]);

      await service.dispatch(EST_ID, 'order.created', { order_id: 'o1' });

      expect(mockQueue.add).toHaveBeenCalledTimes(2);
      expect(mockQueue.add).toHaveBeenCalledWith(
        'deliver',
        expect.objectContaining({ event: 'order.created', webhookId: 'wh-1' }),
        expect.objectContaining({ attempts: 5, backoff: { type: 'exponential', delay: 1000 } }),
      );
    });

    it('enqueues nothing when no webhooks are subscribed', async () => {
      mockWebhook.findMany.mockResolvedValue([]);

      await service.dispatch(EST_ID, 'delivery.started', {});

      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('filters by establishment_id and active + events', async () => {
      await service.dispatch(EST_ID, 'order.created', {});

      expect(mockWebhook.findMany).toHaveBeenCalledWith({
        where: {
          establishment_id: EST_ID,
          active: true,
          events: { has: 'order.created' },
        },
        select: { id: true },
      });
    });
  });
});

// ── DTO validation — events field must be a subset of SUPPORTED_EVENTS ────────

describe('CreateWebhookDto — events validation', () => {
  const validBase = { url: 'https://example.com/hook', secret: 'sec' };

  it('passes with all supported events', async () => {
    const dto = plainToInstance(CreateWebhookDto, {
      ...validBase,
      events: ['order.created', 'delivery.completed'],
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects an unknown event string', async () => {
    const dto = plainToInstance(CreateWebhookDto, {
      ...validBase,
      events: ['order.created', 'shipment.updated'],
    });
    const errors = await validate(dto);
    const eventsError = errors.find((e) => e.property === 'events');
    expect(eventsError).toBeDefined();
  });

  it('rejects an empty events array', async () => {
    const dto = plainToInstance(CreateWebhookDto, { ...validBase, events: [] });
    const errors = await validate(dto);
    expect(errors.find((e) => e.property === 'events')).toBeDefined();
  });

  it('rejects when events is not an array', async () => {
    const dto = plainToInstance(CreateWebhookDto, { ...validBase, events: 'order.created' });
    const errors = await validate(dto);
    expect(errors.find((e) => e.property === 'events')).toBeDefined();
  });
});

describe('UpdateWebhookDto — events validation', () => {
  it('passes when events is omitted (all fields optional)', async () => {
    const dto = plainToInstance(UpdateWebhookDto, { active: false });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects an unknown event when events is provided', async () => {
    const dto = plainToInstance(UpdateWebhookDto, { events: ['delivery.teleported'] });
    const errors = await validate(dto);
    expect(errors.find((e) => e.property === 'events')).toBeDefined();
  });

  it('passes with a valid single supported event', async () => {
    const dto = plainToInstance(UpdateWebhookDto, { events: ['delivery.failed'] });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
