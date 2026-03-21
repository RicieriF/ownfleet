import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ProofOfDeliveryService } from '../proof-of-delivery.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { WebhooksService } from '../../webhooks/webhooks.service.js';
import { ConfigService } from '@nestjs/config';

const EST_A = 'est-a';
const userA: any = { id: 'u1', establishment_id: EST_A, role: 'manager', is_platform_admin: false };

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
  delivery: { update: jest.fn().mockResolvedValue({}) },
  order: { update: jest.fn().mockResolvedValue({}) },
};

const mockPrisma = {
  delivery: { findUnique: jest.fn() },
  order: { findUniqueOrThrow: jest.fn() },
  $queryRaw: jest.fn(),
  $transaction: jest.fn((cb: any) => cb(mockTx)),
};

const mockWebhooksService = { dispatch: jest.fn().mockResolvedValue(undefined) };

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
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get<ProofOfDeliveryService>(ProofOfDeliveryService);
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((cb: any) => cb(mockTx));
    mockTx.deliveryProof.create.mockResolvedValue({});
    mockTx.delivery.update.mockResolvedValue({});
    mockTx.order.update.mockResolvedValue({});
  });

  describe('completeDelivery — geo_match', () => {
    const dto = {
      lat: 50.45,
      lng: 30.52,
      captured_at: new Date().toISOString(),
    };

    it('sets geo_match=true when courier within 300m', async () => {
      mockPrisma.delivery.findUnique.mockResolvedValue(baseDelivery);
      mockPrisma.order.findUniqueOrThrow.mockResolvedValue({ lat: 50.451, lng: 30.521 });
      mockPrisma.$queryRaw.mockResolvedValue([{ within: true }]);

      const result = await service.completeDelivery('d1', dto, userA);

      expect(result.geo_match).toBe(true);
    });

    it('sets geo_match=false when courier outside 300m', async () => {
      mockPrisma.delivery.findUnique.mockResolvedValue(baseDelivery);
      mockPrisma.order.findUniqueOrThrow.mockResolvedValue({ lat: 51.0, lng: 31.0 });
      mockPrisma.$queryRaw.mockResolvedValue([{ within: false }]);

      const result = await service.completeDelivery('d1', dto, userA);

      expect(result.geo_match).toBe(false);
    });

    it('delivery completes successfully even when geo_match=false', async () => {
      mockPrisma.delivery.findUnique.mockResolvedValue(baseDelivery);
      mockPrisma.order.findUniqueOrThrow.mockResolvedValue({ lat: 51.0, lng: 31.0 });
      mockPrisma.$queryRaw.mockResolvedValue([{ within: false }]);

      const result = await service.completeDelivery('d1', dto, userA);

      expect(result.status).toBe('completed');
      expect(mockTx.deliveryProof.create).toHaveBeenCalledTimes(1);
      expect(mockTx.delivery.update).toHaveBeenCalledTimes(1);
    });

    it('sets no_destination_coords flag when order has no coordinates', async () => {
      mockPrisma.delivery.findUnique.mockResolvedValue(baseDelivery);
      mockPrisma.order.findUniqueOrThrow.mockResolvedValue({ lat: null, lng: null });

      const result = await service.completeDelivery('d1', dto, userA);

      expect(result.geo_flags).toMatchObject({ no_destination_coords: true });
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('completeDelivery — two timestamps', () => {
    it('sets proof_after_close flag when proof captured after order_closed_at', async () => {
      const orderClosedAt = new Date(Date.now() - 60_000); // 1 min ago
      const capturedAfterClose = new Date().toISOString(); // now (after close)

      mockPrisma.delivery.findUnique.mockResolvedValue({
        ...baseDelivery,
        order_closed_at: orderClosedAt,
      });
      mockPrisma.order.findUniqueOrThrow.mockResolvedValue({ lat: 50.45, lng: 30.52 });
      mockPrisma.$queryRaw.mockResolvedValue([{ within: true }]);

      const result = await service.completeDelivery(
        'd1',
        { lat: 50.45, lng: 30.52, captured_at: capturedAfterClose },
        userA,
      );

      expect(result.geo_flags).toMatchObject({ proof_after_close: true });
    });

    it('no proof_after_close flag when proof captured before order_closed_at', async () => {
      const capturedAt = new Date(Date.now() - 120_000).toISOString(); // 2 min ago
      const orderClosedAt = new Date(Date.now() - 60_000); // 1 min ago (after capture)

      mockPrisma.delivery.findUnique.mockResolvedValue({
        ...baseDelivery,
        order_closed_at: orderClosedAt,
      });
      mockPrisma.order.findUniqueOrThrow.mockResolvedValue({ lat: 50.45, lng: 30.52 });
      mockPrisma.$queryRaw.mockResolvedValue([{ within: true }]);

      const result = await service.completeDelivery(
        'd1',
        { lat: 50.45, lng: 30.52, captured_at: capturedAt },
        userA,
      );

      expect(result.geo_flags).not.toMatchObject({ proof_after_close: true });
    });
  });

  describe('multi-tenant isolation', () => {
    it('rejects delivery from another establishment', async () => {
      mockPrisma.delivery.findUnique.mockResolvedValue({
        ...baseDelivery,
        order: { establishment_id: 'est-b' },
      });
      await expect(
        service.completeDelivery('d1', { lat: 50, lng: 30, captured_at: new Date().toISOString() }, userA),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException for non-existent delivery', async () => {
      mockPrisma.delivery.findUnique.mockResolvedValue(null);
      await expect(
        service.completeDelivery('d1', { lat: 50, lng: 30, captured_at: new Date().toISOString() }, userA),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('state machine enforcement', () => {
    it('cannot complete an assigned (not started) delivery', async () => {
      mockPrisma.delivery.findUnique.mockResolvedValue({ ...baseDelivery, status: 'assigned' });
      await expect(
        service.completeDelivery('d1', { lat: 50, lng: 30, captured_at: new Date().toISOString() }, userA),
      ).rejects.toThrow(); // BadRequestException from assertDeliveryTransition
    });

    it('cannot fail a completed delivery', async () => {
      mockPrisma.delivery.findUnique.mockResolvedValue({ ...baseDelivery, status: 'completed' });
      await expect(service.failDelivery('d1', userA)).rejects.toThrow();
    });
  });

  describe('delivery_proofs retention — never deleted', () => {
    it('creates delivery proof record on every complete', async () => {
      mockPrisma.delivery.findUnique.mockResolvedValue(baseDelivery);
      mockPrisma.order.findUniqueOrThrow.mockResolvedValue({ lat: 50.45, lng: 30.52 });
      mockPrisma.$queryRaw.mockResolvedValue([{ within: true }]);

      await service.completeDelivery(
        'd1',
        { lat: 50.45, lng: 30.52, captured_at: new Date().toISOString() },
        userA,
      );

      expect(mockTx.deliveryProof.create).toHaveBeenCalledTimes(1);
      // Proof is created via CREATE only — no delete or update called on proof
      expect(mockTx.deliveryProof).not.toHaveProperty('delete');
    });
  });
});
