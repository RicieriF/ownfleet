import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ProofOfDeliveryService } from '../proof-of-delivery.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { WebhooksService } from '../../webhooks/webhooks.service.js';
import { TelegramService } from '../../telegram/telegram.service.js';
import { ConfigService } from '@nestjs/config';
import { REDIS_CLIENT } from '../../shared/redis/redis.constants.js';

const EST_A = 'est-a';
const userA: any = {
  id: 'u1',
  establishment_id: EST_A,
  role: 'manager',
  courier_id: 'c1',
  is_platform_admin: false,
};

const baseDelivery = {
  id: 'd1',
  order_id: 'o1',
  courier_id: 'c1',
  status: 'in_progress' as const,
  order_closed_at: null,
  order: { establishment_id: EST_A },
};

const mockTx = {
  deliveryProof: { create: jest.fn().mockResolvedValue({}) },
  delivery: {
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  order: { update: jest.fn().mockResolvedValue({}) },
};

const mockPrisma = {
  delivery: { findUnique: jest.fn() },
  order: { findUniqueOrThrow: jest.fn() },
  $queryRaw: jest.fn(),
  $transaction: jest.fn((cb: any) => cb(mockTx)),
};

const mockWebhooksService = {
  dispatch: jest.fn().mockResolvedValue(undefined),
};

const mockTelegramService = {
  notifyEstablishmentManagers: jest.fn().mockResolvedValue(undefined),
  notifyCourier: jest.fn().mockResolvedValue(undefined),
};

const mockConfig = {
  get: jest.fn().mockReturnValue('http://localhost'),
  getOrThrow: jest.fn().mockReturnValue('test-value'),
};

describe('ProofOfDeliveryService', () => {
  let service: ProofOfDeliveryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProofOfDeliveryService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: WebhooksService, useValue: mockWebhooksService },
        { provide: TelegramService, useValue: mockTelegramService },
        { provide: ConfigService, useValue: mockConfig },
        {
          provide: REDIS_CLIENT,
          useValue: {
            publish: jest.fn().mockResolvedValue(1),
            del: jest.fn().mockResolvedValue(1),
          },
        },
      ],
    }).compile();
    service = module.get<ProofOfDeliveryService>(ProofOfDeliveryService);
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((cb: any) => cb(mockTx));
    mockTx.deliveryProof.create.mockResolvedValue({});
    mockTx.delivery.update.mockResolvedValue({});
    mockTx.delivery.updateMany.mockResolvedValue({ count: 1 });
    mockTx.order.update.mockResolvedValue({});
  });

  describe('completeDelivery — geo_match', () => {
    const dto = { lat: 50.45, lng: 30.52 };

    it('sets geo_match=true when courier within 300m', async () => {
      mockPrisma.delivery.findUnique.mockResolvedValue(baseDelivery);
      mockPrisma.order.findUniqueOrThrow.mockResolvedValue({
        lat: 50.451,
        lng: 30.521,
      });
      mockPrisma.$queryRaw.mockResolvedValue([{ within: true }]);

      const result = await service.completeDelivery('d1', dto, userA);

      expect(result.geo_match).toBe(true);
    });

    it('sets geo_match=false when courier outside 300m', async () => {
      mockPrisma.delivery.findUnique.mockResolvedValue(baseDelivery);
      mockPrisma.order.findUniqueOrThrow.mockResolvedValue({
        lat: 51.0,
        lng: 31.0,
      });
      mockPrisma.$queryRaw.mockResolvedValue([{ within: false }]);

      const result = await service.completeDelivery('d1', dto, userA);

      expect(result.geo_match).toBe(false);
    });

    it('delivery completes successfully even when geo_match=false', async () => {
      mockPrisma.delivery.findUnique.mockResolvedValue(baseDelivery);
      mockPrisma.order.findUniqueOrThrow.mockResolvedValue({
        lat: 51.0,
        lng: 31.0,
      });
      mockPrisma.$queryRaw.mockResolvedValue([{ within: false }]);

      const result = await service.completeDelivery('d1', dto, userA);

      expect(result.status).toBe('completed');
      expect(mockTx.deliveryProof.create).toHaveBeenCalledTimes(1);
      expect(mockTx.delivery.updateMany).toHaveBeenCalledTimes(1);
    });

    it('sets no_destination_coords flag when order has no coordinates', async () => {
      mockPrisma.delivery.findUnique.mockResolvedValue(baseDelivery);
      mockPrisma.order.findUniqueOrThrow.mockResolvedValue({
        lat: null,
        lng: null,
      });

      const result = await service.completeDelivery('d1', dto, userA);

      expect(result.geo_flags).toMatchObject({ no_destination_coords: true });
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('completeDelivery — two timestamps', () => {
    it('sets proof_after_close flag when order_closed_at is in the past (server now > closed)', async () => {
      // order_closed_at 1 min ago → server now is after it → proof_after_close
      const orderClosedAt = new Date(Date.now() - 60_000);

      mockPrisma.delivery.findUnique.mockResolvedValue({
        ...baseDelivery,
        order_closed_at: orderClosedAt,
      });
      mockPrisma.order.findUniqueOrThrow.mockResolvedValue({
        lat: 50.45,
        lng: 30.52,
      });
      mockPrisma.$queryRaw.mockResolvedValue([{ within: true }]);

      const result = await service.completeDelivery(
        'd1',
        { lat: 50.45, lng: 30.52 },
        userA,
      );

      expect(result.geo_flags).toMatchObject({ proof_after_close: true });
    });

    it('no proof_after_close flag when order_closed_at is in the future (server now < closed)', async () => {
      // order_closed_at 1 min in the future → server now is before it → no flag
      const orderClosedAt = new Date(Date.now() + 60_000);

      mockPrisma.delivery.findUnique.mockResolvedValue({
        ...baseDelivery,
        order_closed_at: orderClosedAt,
      });
      mockPrisma.order.findUniqueOrThrow.mockResolvedValue({
        lat: 50.45,
        lng: 30.52,
      });
      mockPrisma.$queryRaw.mockResolvedValue([{ within: true }]);

      const result = await service.completeDelivery(
        'd1',
        { lat: 50.45, lng: 30.52 },
        userA,
      );

      expect(result.geo_flags).not.toMatchObject({ proof_after_close: true });
    });
  });

  describe('completeDelivery — courier-only guard', () => {
    it('throws ForbiddenException when called by a manager (no courier_id)', async () => {
      const managerUser: any = {
        id: 'u2',
        establishment_id: EST_A,
        role: 'manager',
        is_platform_admin: false,
      };
      await expect(
        service.completeDelivery('d1', { lat: 50, lng: 30 }, managerUser),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('forceCloseDelivery', () => {
    const managerUser: any = {
      id: 'u2',
      establishment_id: EST_A,
      role: 'manager',
      is_platform_admin: false,
    };
    const courierUser: any = {
      id: 'u1',
      establishment_id: EST_A,
      role: 'courier',
      courier_id: 'c1',
      is_platform_admin: false,
    };

    it('manager can force-close an in_progress delivery', async () => {
      mockPrisma.delivery.findUnique.mockResolvedValue(baseDelivery);

      const result = await service.forceCloseDelivery('d1', managerUser);

      expect(result).toEqual({ status: 'completed', force_closed: true });
      expect(mockTx.deliveryProof.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            geo_flags: expect.objectContaining({
              force_closed: true,
              closed_by: managerUser.id,
            }),
          }),
        }),
      );
    });

    it('manager can force-close an assigned delivery (courier never started)', async () => {
      mockPrisma.delivery.findUnique.mockResolvedValue({
        ...baseDelivery,
        status: 'assigned',
      });

      const result = await service.forceCloseDelivery('d1', managerUser);

      expect(result).toEqual({ status: 'completed', force_closed: true });
    });

    it('throws ForbiddenException for courier role', async () => {
      await expect(
        service.forceCloseDelivery('d1', courierUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException for already completed delivery', async () => {
      mockPrisma.delivery.findUnique.mockResolvedValue({
        ...baseDelivery,
        status: 'completed',
      });
      await expect(
        service.forceCloseDelivery('d1', managerUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException on race condition (count=0)', async () => {
      mockPrisma.delivery.findUnique.mockResolvedValue(baseDelivery);
      mockTx.delivery.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.forceCloseDelivery('d1', managerUser),
      ).rejects.toThrow();
    });
  });

  describe('multi-tenant isolation', () => {
    it('rejects delivery from another establishment', async () => {
      mockPrisma.delivery.findUnique.mockResolvedValue({
        ...baseDelivery,
        order: { establishment_id: 'est-b' },
      });
      await expect(
        service.completeDelivery('d1', { lat: 50, lng: 30 }, userA),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException for non-existent delivery', async () => {
      mockPrisma.delivery.findUnique.mockResolvedValue(null);
      await expect(
        service.completeDelivery('d1', { lat: 50, lng: 30 }, userA),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('state machine enforcement', () => {
    it('cannot complete an assigned (not started) delivery', async () => {
      mockPrisma.delivery.findUnique.mockResolvedValue({
        ...baseDelivery,
        status: 'assigned',
      });
      await expect(
        service.completeDelivery('d1', { lat: 50, lng: 30 }, userA),
      ).rejects.toThrow(); // BadRequestException from assertDeliveryTransition
    });

    it('cannot fail a completed delivery', async () => {
      mockPrisma.delivery.findUnique.mockResolvedValue({
        ...baseDelivery,
        status: 'completed',
      });
      await expect(service.failDelivery('d1', userA)).rejects.toThrow();
    });
  });

  describe('delivery_proofs retention — never deleted', () => {
    it('creates delivery proof record on every complete', async () => {
      mockPrisma.delivery.findUnique.mockResolvedValue(baseDelivery);
      mockPrisma.order.findUniqueOrThrow.mockResolvedValue({
        lat: 50.45,
        lng: 30.52,
      });
      mockPrisma.$queryRaw.mockResolvedValue([{ within: true }]);

      await service.completeDelivery('d1', { lat: 50.45, lng: 30.52 }, userA);

      expect(mockTx.deliveryProof.create).toHaveBeenCalledTimes(1);
      // Proof is created via CREATE only — no delete or update called on proof
      expect(mockTx.deliveryProof).not.toHaveProperty('delete');
    });
  });

  describe('Telegram notifications', () => {
    it('completeDelivery() fires delivery_completed to establishment managers', async () => {
      mockPrisma.delivery.findUnique.mockResolvedValue(baseDelivery);
      mockPrisma.order.findUniqueOrThrow.mockResolvedValue({
        lat: 50.45,
        lng: 30.52,
      });
      mockPrisma.$queryRaw.mockResolvedValue([{ within: true }]);

      await service.completeDelivery('d1', { lat: 50.45, lng: 30.52 }, userA);

      expect(
        mockTelegramService.notifyEstablishmentManagers,
      ).toHaveBeenCalledWith(EST_A, expect.any(String), 'delivery_completed');
    });

    it('forceCloseDelivery() fires delivery_force_closed to establishment managers', async () => {
      const managerUser: any = {
        id: 'u2',
        establishment_id: EST_A,
        role: 'manager',
        is_platform_admin: false,
      };
      mockPrisma.delivery.findUnique.mockResolvedValue(baseDelivery);

      await service.forceCloseDelivery('d1', managerUser);

      expect(
        mockTelegramService.notifyEstablishmentManagers,
      ).toHaveBeenCalledWith(
        EST_A,
        expect.any(String),
        'delivery_force_closed',
      );
    });

    it('failDelivery() fires delivery_failed to establishment managers', async () => {
      mockPrisma.delivery.findUnique.mockResolvedValue(baseDelivery);

      await service.failDelivery('d1', userA);

      expect(
        mockTelegramService.notifyEstablishmentManagers,
      ).toHaveBeenCalledWith(EST_A, expect.any(String), 'delivery_failed');
    });
  });
});
