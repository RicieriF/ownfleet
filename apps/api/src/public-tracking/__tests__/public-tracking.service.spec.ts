import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PublicTrackingService } from '../public-tracking.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../shared/redis/redis.constants.js';

const EST_A = 'est-a';
const EST_B = 'est-b';

const managerUser: any = { id: 'u1', establishment_id: EST_A, role: 'manager', is_platform_admin: false };

const mockEstablishment = {
  name: 'Піцерія Везувій',
  delivery_sla_minutes: null,
  settings: {},
};

const mockTrackingToken = {
  create: jest.fn(),
  findUniqueOrThrow: jest.fn(),
  findUnique: jest.fn(),
  updateMany: jest.fn(),
};

const mockOrder = {
  findFirst: jest.fn(),
  findUnique: jest.fn(),
};

const mockDelivery = {
  findFirst: jest.fn(),
};

const mockPrisma = {
  trackingToken: mockTrackingToken,
  order: mockOrder,
  delivery: mockDelivery,
};

const mockRedis = {
  get: jest.fn().mockResolvedValue(null),
};

const validToken = {
  order_id: 'order-1',
  expires_at: new Date(Date.now() + 3_600_000),
};

const pendingOrder = {
  status: 'pending',
  lat: 50.45,
  lng: 30.52,
  address: 'вул. Хрещатик 1',
  ready_at: null,
  created_at: new Date('2026-01-01T10:00:00Z'),
  establishment: mockEstablishment,
};

describe('PublicTrackingService', () => {
  let service: PublicTrackingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublicTrackingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    service = module.get<PublicTrackingService>(PublicTrackingService);
    jest.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);
    mockDelivery.findFirst.mockResolvedValue(null);
  });

  // ── getOrCreateToken ──────────────────────────────────────────────────────

  describe('getOrCreateToken', () => {
    it('creates and returns a new token', async () => {
      mockTrackingToken.create.mockResolvedValue({ token: 'tok-abc' });

      const result = await service.getOrCreateToken('order-1');
      expect(result).toBe('tok-abc');
      expect(mockTrackingToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ order_id: 'order-1' }),
          select: { token: true },
        }),
      );
    });

    it('returns existing token on P2002 (race condition idempotency)', async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: '5.0',
      });
      mockTrackingToken.create.mockRejectedValue(p2002);
      mockTrackingToken.findUniqueOrThrow.mockResolvedValue({ token: 'tok-existing' });

      const result = await service.getOrCreateToken('order-1');
      expect(result).toBe('tok-existing');
      expect(mockTrackingToken.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { order_id: 'order-1' },
        select: { token: true },
      });
    });

    it('re-throws non-P2002 errors', async () => {
      mockTrackingToken.create.mockRejectedValue(new Error('DB connection lost'));
      await expect(service.getOrCreateToken('order-1')).rejects.toThrow('DB connection lost');
    });
  });

  // ── getTokenByExternalId ──────────────────────────────────────────────────

  describe('getTokenByExternalId', () => {
    it('throws NotFoundException when order not found for establishment', async () => {
      mockOrder.findFirst.mockResolvedValue(null);
      await expect(service.getTokenByExternalId('ext-1', EST_A)).rejects.toThrow(NotFoundException);
    });

    it('returns token scoped to establishment (multi-tenant)', async () => {
      mockOrder.findFirst.mockResolvedValue({ id: 'order-1' });
      mockTrackingToken.create.mockResolvedValue({ token: 'tok-xyz' });

      const result = await service.getTokenByExternalId('ext-1', EST_A);
      expect(result.token).toBe('tok-xyz');
      expect(mockOrder.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ external_id: 'ext-1', establishment_id: EST_A }),
        }),
      );
    });
  });

  // ── getTokenForManager ────────────────────────────────────────────────────

  describe('getTokenForManager', () => {
    it('throws NotFoundException when order not found', async () => {
      mockOrder.findUnique.mockResolvedValue(null);
      await expect(service.getTokenForManager('order-x', managerUser)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when order belongs to different establishment (multi-tenant)', async () => {
      mockOrder.findUnique.mockResolvedValue({ id: 'order-1', establishment_id: EST_B });
      await expect(service.getTokenForManager('order-1', managerUser)).rejects.toThrow(NotFoundException);
    });

    it('returns token for own establishment order', async () => {
      mockOrder.findUnique.mockResolvedValue({ id: 'order-1', establishment_id: EST_A });
      mockTrackingToken.create.mockResolvedValue({ token: 'tok-mgr' });

      const result = await service.getTokenForManager('order-1', managerUser);
      expect(result.token).toBe('tok-mgr');
    });
  });

  // ── getSnapshot ───────────────────────────────────────────────────────────

  describe('getSnapshot', () => {
    it('returns null for unknown token', async () => {
      mockTrackingToken.findUnique.mockResolvedValue(null);
      expect(await service.getSnapshot('bad-token')).toBeNull();
    });

    it('returns null for expired token', async () => {
      mockTrackingToken.findUnique.mockResolvedValue({
        order_id: 'order-1',
        expires_at: new Date(Date.now() - 1000),
      });
      expect(await service.getSnapshot('expired-token')).toBeNull();
    });

    it('returns null when order no longer exists', async () => {
      mockTrackingToken.findUnique.mockResolvedValue(validToken);
      mockOrder.findUnique.mockResolvedValue(null);
      expect(await service.getSnapshot('valid-token')).toBeNull();
    });

    it('State 0 — pending order, no delivery: null delivery fields', async () => {
      mockTrackingToken.findUnique.mockResolvedValue(validToken);
      mockOrder.findUnique.mockResolvedValue(pendingOrder);
      mockDelivery.findFirst.mockResolvedValue(null);

      const result = await service.getSnapshot('valid-token');
      expect(result).not.toBeNull();
      expect(result!.orderStatus).toBe('pending');
      expect(result!.deliveryStatus).toBeNull();
      expect(result!.courierName).toBeNull();
      expect(result!.courierTransportMode).toBeNull();
      expect(result!.etaSeconds).toBeNull();
      expect(result!.routeGeometry).toBeNull();
      expect(result!.slaDeadline).toBeNull();
    });

    it('returns establishmentName, locale, tokenExpiresAt in all states', async () => {
      mockTrackingToken.findUnique.mockResolvedValue(validToken);
      mockOrder.findUnique.mockResolvedValue({
        ...pendingOrder,
        establishment: { name: 'Піцерія Везувій', delivery_sla_minutes: null, settings: { locale: 'en' } },
      });
      mockDelivery.findFirst.mockResolvedValue(null);

      const result = await service.getSnapshot('valid-token');
      expect(result!.establishmentName).toBe('Піцерія Везувій');
      expect(result!.locale).toBe('en');
      expect(result!.tokenExpiresAt).toBe(validToken.expires_at.toISOString());
    });

    it('defaults locale to "uk" when not set in settings', async () => {
      mockTrackingToken.findUnique.mockResolvedValue(validToken);
      mockOrder.findUnique.mockResolvedValue(pendingOrder); // settings: {}
      mockDelivery.findFirst.mockResolvedValue(null);

      const result = await service.getSnapshot('valid-token');
      expect(result!.locale).toBe('uk');
    });

    it('State 1 — delivery assigned, eta_started_at null: returns original eta_seconds', async () => {
      mockTrackingToken.findUnique.mockResolvedValue(validToken);
      mockOrder.findUnique.mockResolvedValue(pendingOrder);
      mockDelivery.findFirst.mockResolvedValue({
        id: 'del-1',
        status: 'assigned',
        eta_seconds: 900,
        eta_started_at: null,
        courier: { name: 'Іван', transport_mode: 'moto_gas' },
      });

      const result = await service.getSnapshot('valid-token');
      expect(result!.deliveryStatus).toBe('assigned');
      expect(result!.courierName).toBe('Іван');
      expect(result!.courierTransportMode).toBe('moto_gas');
      expect(result!.etaSeconds).toBe(900); // original, not computed
    });

    it('State 2 — in_progress with eta_started_at: computes remaining etaSeconds', async () => {
      const etaStartedAt = new Date(Date.now() - 300_000); // 5 min ago
      mockTrackingToken.findUnique.mockResolvedValue(validToken);
      mockOrder.findUnique.mockResolvedValue(pendingOrder);
      mockDelivery.findFirst.mockResolvedValue({
        id: 'del-1',
        status: 'in_progress',
        eta_seconds: 600, // 10 min original
        eta_started_at: etaStartedAt,
        courier: { name: 'Іван', transport_mode: 'bicycle' },
      });

      const result = await service.getSnapshot('valid-token');
      // ~5 min remaining (600 - 300 ≈ 300), with ±5s tolerance
      expect(result!.etaSeconds).toBeGreaterThanOrEqual(295);
      expect(result!.etaSeconds).toBeLessThanOrEqual(305);
    });

    it('clamps computed etaSeconds to 0 (never negative)', async () => {
      mockTrackingToken.findUnique.mockResolvedValue(validToken);
      mockOrder.findUnique.mockResolvedValue(pendingOrder);
      mockDelivery.findFirst.mockResolvedValue({
        id: 'del-1',
        status: 'in_progress',
        eta_seconds: 60,
        eta_started_at: new Date(Date.now() - 600_000), // 10 min ago, well past eta
        courier: { name: 'Іван', transport_mode: 'car' },
      });

      const result = await service.getSnapshot('valid-token');
      expect(result!.etaSeconds).toBe(0);
    });

    it('reassignment rule: uses delivery with status != failed, most recent first', async () => {
      mockTrackingToken.findUnique.mockResolvedValue(validToken);
      mockOrder.findUnique.mockResolvedValue(pendingOrder);
      mockDelivery.findFirst.mockResolvedValue({
        id: 'del-2',
        status: 'assigned',
        eta_seconds: 720,
        eta_started_at: null,
        courier: { name: 'Новий Кур\'єр', transport_mode: 'car' },
      });

      const result = await service.getSnapshot('valid-token');
      // findFirst is called with status != 'failed' and orderBy assigned_at desc
      expect(mockDelivery.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: { not: 'failed' } }),
          orderBy: { assigned_at: 'desc' },
        }),
      );
      expect(result!.courierName).toBe('Новий Кур\'єр');
    });

    it('returns routeGeometry from Redis cache when delivery in_progress', async () => {
      const geometry = { type: 'LineString', coordinates: [[30.52, 50.45]] };
      mockTrackingToken.findUnique.mockResolvedValue(validToken);
      mockOrder.findUnique.mockResolvedValue(pendingOrder);
      mockDelivery.findFirst.mockResolvedValue({
        id: 'del-1',
        status: 'in_progress',
        eta_seconds: 300,
        eta_started_at: null,
        courier: { name: 'Іван', transport_mode: 'moto_gas' },
      });
      mockRedis.get.mockResolvedValue(JSON.stringify(geometry));

      const result = await service.getSnapshot('valid-token');
      expect(result!.routeGeometry).toEqual(geometry);
      expect(mockRedis.get).toHaveBeenCalledWith('route:del-1');
    });

    it('returns null routeGeometry when delivery not in_progress', async () => {
      mockTrackingToken.findUnique.mockResolvedValue(validToken);
      mockOrder.findUnique.mockResolvedValue(pendingOrder);
      mockDelivery.findFirst.mockResolvedValue({
        id: 'del-1',
        status: 'assigned', // not in_progress
        eta_seconds: 900,
        eta_started_at: null,
        courier: { name: 'Іван', transport_mode: 'car' },
      });

      const result = await service.getSnapshot('valid-token');
      expect(result!.routeGeometry).toBeNull();
      expect(mockRedis.get).not.toHaveBeenCalled();
    });

    it('returns null routeGeometry on Redis error (graceful degradation)', async () => {
      mockTrackingToken.findUnique.mockResolvedValue(validToken);
      mockOrder.findUnique.mockResolvedValue(pendingOrder);
      mockDelivery.findFirst.mockResolvedValue({
        id: 'del-1',
        status: 'in_progress',
        eta_seconds: 300,
        eta_started_at: null,
        courier: { name: 'Іван', transport_mode: 'car' },
      });
      mockRedis.get.mockRejectedValue(new Error('Redis connection lost'));

      const result = await service.getSnapshot('valid-token');
      expect(result!.routeGeometry).toBeNull(); // no 500 — graceful
    });

    it('computes slaDeadline from ready_at + sla_minutes when delivery exists', async () => {
      const readyAt = new Date('2026-01-01T10:00:00Z');
      mockTrackingToken.findUnique.mockResolvedValue(validToken);
      mockOrder.findUnique.mockResolvedValue({
        ...pendingOrder,
        ready_at: readyAt,
        establishment: { name: 'Test', delivery_sla_minutes: 30, settings: {} },
      });
      mockDelivery.findFirst.mockResolvedValue({
        id: 'del-1',
        status: 'assigned',
        eta_seconds: 900,
        eta_started_at: null,
        courier: { name: 'Іван', transport_mode: 'car' },
      });

      const result = await service.getSnapshot('valid-token');
      const expectedDeadline = new Date(readyAt.getTime() + 30 * 60 * 1000).toISOString();
      expect(result!.slaDeadline).toBe(expectedDeadline);
    });

    it('returns null slaDeadline when no delivery (cannot promise deadline without courier)', async () => {
      mockTrackingToken.findUnique.mockResolvedValue(validToken);
      mockOrder.findUnique.mockResolvedValue({
        ...pendingOrder,
        establishment: { name: 'Test', delivery_sla_minutes: 30, settings: {} },
      });
      mockDelivery.findFirst.mockResolvedValue(null); // no delivery yet

      const result = await service.getSnapshot('valid-token');
      expect(result!.slaDeadline).toBeNull();
    });

    it('State 3 — delivery completed: deliveryStatus=completed, routeGeometry=null', async () => {
      mockTrackingToken.findUnique.mockResolvedValue(validToken);
      mockOrder.findUnique.mockResolvedValue({ ...pendingOrder, status: 'completed' });
      mockDelivery.findFirst.mockResolvedValue({
        id: 'del-1',
        status: 'completed',
        eta_seconds: null,
        eta_started_at: null,
        courier: { name: 'Іван', transport_mode: 'car' },
      });

      const result = await service.getSnapshot('valid-token');
      expect(result!.orderStatus).toBe('completed');
      expect(result!.deliveryStatus).toBe('completed');
      expect(result!.etaSeconds).toBeNull();
      // Route geometry is only fetched for in_progress deliveries
      expect(result!.routeGeometry).toBeNull();
      expect(mockRedis.get).not.toHaveBeenCalled();
    });

    it('State 4 — order cancelled: orderStatus=cancelled, deliveryStatus=null', async () => {
      mockTrackingToken.findUnique.mockResolvedValue(validToken);
      mockOrder.findUnique.mockResolvedValue({ ...pendingOrder, status: 'cancelled' });
      mockDelivery.findFirst.mockResolvedValue(null);

      const result = await service.getSnapshot('valid-token');
      expect(result!.orderStatus).toBe('cancelled');
      expect(result!.deliveryStatus).toBeNull();
      expect(result!.courierName).toBeNull();
      expect(result!.etaSeconds).toBeNull();
    });

    it('State 5 — all deliveries failed: deliveryStatus=null (non-failed query returns null)', async () => {
      // Order is still in_progress (waiting for reassignment), but no non-failed delivery exists
      mockTrackingToken.findUnique.mockResolvedValue(validToken);
      mockOrder.findUnique.mockResolvedValue({ ...pendingOrder, status: 'in_progress' });
      // findFirst(status: { not: 'failed' }) returns null — all deliveries are failed
      mockDelivery.findFirst.mockResolvedValue(null);

      const result = await service.getSnapshot('valid-token');
      expect(result!.orderStatus).toBe('in_progress');
      expect(result!.deliveryStatus).toBeNull(); // no active delivery
      expect(result!.courierName).toBeNull();
      expect(result!.etaSeconds).toBeNull();
      expect(result!.routeGeometry).toBeNull();
      // Verify the query excludes failed deliveries
      expect(mockDelivery.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: { not: 'failed' } }),
        }),
      );
    });

    it('State 2 without coords — orderLat/orderLng null, routeGeometry null', async () => {
      mockTrackingToken.findUnique.mockResolvedValue(validToken);
      // Order geocoding failed — no coordinates
      mockOrder.findUnique.mockResolvedValue({ ...pendingOrder, lat: null, lng: null });
      mockDelivery.findFirst.mockResolvedValue({
        id: 'del-1',
        status: 'in_progress',
        eta_seconds: 600,
        eta_started_at: null,
        courier: { name: 'Іван', transport_mode: 'bicycle' },
      });
      // Redis has no route cached (geocoding never succeeded)
      mockRedis.get.mockResolvedValue(null);

      const result = await service.getSnapshot('valid-token');
      expect(result!.orderLat).toBeNull();
      expect(result!.orderLng).toBeNull();
      // routeGeometry is null (Redis miss) — embed shows text mode
      expect(result!.routeGeometry).toBeNull();
      // ETA is still present even without coords
      expect(result!.etaSeconds).toBe(600);
    });
  });
});
