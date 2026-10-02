import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bull';
import { TrackingService, PING_PERSIST_QUEUE } from '../tracking.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../redis.provider.js';

const EST_A = 'est-a';
const EST_B = 'est-b';

// Courier-linked user (has courier_id in JWT)
const courierUser: any = {
  id: 'u1',
  establishment_id: EST_A,
  role: 'manager',
  is_platform_admin: false,
  courier_id: 'c1',
};
// Manager user (no courier_id)
const managerUser: any = {
  id: 'u2',
  establishment_id: EST_A,
  role: 'manager',
  is_platform_admin: false,
};

const courierA = { id: 'c1', establishment_id: EST_A };
const courierB = { id: 'c2', establishment_id: EST_B };

const mockPrisma = {
  courier: { findUnique: jest.fn() },
  $executeRaw: jest.fn().mockResolvedValue(1),
};

const mockRedis = {
  setex: jest.fn().mockResolvedValue('OK'),
  publish: jest.fn().mockResolvedValue(1),
  get: jest.fn(),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  eval: jest.fn().mockResolvedValue(1),
};

const mockPingQueue = {
  add: jest.fn().mockResolvedValue({}),
};

describe('TrackingService', () => {
  let service: TrackingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrackingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: getQueueToken(PING_PERSIST_QUEUE), useValue: mockPingQueue },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(undefined) },
        },
      ],
    }).compile();
    service = module.get<TrackingService>(TrackingService);
    jest.clearAllMocks();
    mockPrisma.$executeRaw.mockResolvedValue(1);
    mockRedis.setex.mockResolvedValue('OK');
    mockRedis.publish.mockResolvedValue(1);
    mockRedis.eval.mockResolvedValue(1);
    mockPingQueue.add.mockResolvedValue({});
  });

  describe('handlePing', () => {
    const validPing = {
      lat: 50.45,
      lng: 30.52,
      battery: 80,
      accuracy: 12,
      event_uid: '11111111-1111-4111-8111-111111111111',
      captured_at: '2026-10-02T08:00:00.000Z',
    };

    it('rejects ping from non-courier (manager) account', async () => {
      await expect(service.handlePing(validPing, managerUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('enqueues ping for async DB persist via Bull', async () => {
      await service.handlePing(validPing, courierUser);
      expect(mockPingQueue.add).toHaveBeenCalledWith(
        {
          courier_id: courierUser.courier_id,
          lat: 50.45,
          lng: 30.52,
          battery: 80,
          accuracy: 12,
          event_uid: validPing.event_uid,
          captured_at: validPing.captured_at,
        },
        // removeOnComplete/removeOnFail are configured in defaultJobOptions at module level,
        // not per-call — so the per-call options object is empty.
        { jobId: validPing.event_uid },
      );
      // DB write is NOT called synchronously — it happens in the processor
      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('caches last position in Redis with TTL 300s', async () => {
      await service.handlePing(validPing, courierUser);
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        `courier:location:${courierUser.courier_id}`,
        String(new Date(validPing.captured_at).getTime()),
        '300',
        expect.stringContaining('"accuracy":12'),
      );
    });

    it('does not republish an older offline retry as the live position', async () => {
      mockRedis.eval.mockResolvedValue(0);
      await service.handlePing(validPing, courierUser);

      expect(mockPingQueue.add).toHaveBeenCalled();
      expect(mockRedis.publish).not.toHaveBeenCalled();
    });

    it('syncs offline pings in captured order with stable job IDs', async () => {
      const later = {
        ...validPing,
        event_uid: '22222222-2222-4222-8222-222222222222',
        captured_at: '2026-10-02T08:01:00.000Z',
      };
      const result = await service.syncPings([later, validPing], courierUser);

      expect(result.accepted_event_uids).toEqual([
        validPing.event_uid,
        later.event_uid,
      ]);
      expect(mockPingQueue.add.mock.calls[0][1]).toEqual({
        jobId: validPing.event_uid,
      });
      expect(mockPingQueue.add.mock.calls[1][1]).toEqual({
        jobId: later.event_uid,
      });
    });

    it('publishes courier_moved event to Redis pub/sub', async () => {
      await service.handlePing(validPing, courierUser);
      expect(mockRedis.publish).toHaveBeenCalledWith(
        'courier_moved',
        expect.stringContaining('"establishment_id":"est-a"'),
      );
    });
  });

  // ── handlePublicTracking ────────────────────────────────────────────────────

  describe('handlePublicTracking (private — accessed directly)', () => {
    const orderId = 'order-pub';
    const deliveryId = 'del-pub';

    const activeOrderCache = JSON.stringify({
      orderId,
      deliveryId,
      orderLat: 50.45,
      orderLng: 30.52,
      transportProfile: 'driving',
    });

    function callHandlePublicTracking(
      svc: TrackingService,
      lat: number,
      lng: number,
    ) {
      return (svc as any)['handlePublicTracking'].call(
        svc,
        'c1',
        lat,
        lng,
      ) as Promise<void>;
    }

    beforeEach(() => {
      // Default: no active order
      mockRedis.get.mockResolvedValue(null);
      mockRedis.set = jest.fn().mockResolvedValue('OK');
    });

    it('returns early and does NOT publish when courier has no active order', async () => {
      mockRedis.get.mockResolvedValue(null);
      await callHandlePublicTracking(service, 50.45, 30.52);
      expect(mockRedis.publish).not.toHaveBeenCalled();
    });

    it('publishes courier location to order public channel', async () => {
      mockRedis.get.mockResolvedValueOnce(activeOrderCache); // courier:active_order
      await callHandlePublicTracking(service, 50.45, 30.52);
      expect(mockRedis.publish).toHaveBeenCalledWith(
        `order:${orderId}:public`,
        expect.stringContaining('"type":"location"'),
      );
    });

    it('returns after publish when no route:origin key (no route recalc)', async () => {
      mockRedis.get
        .mockResolvedValueOnce(activeOrderCache) // courier:active_order
        .mockResolvedValueOnce(null); // route:origin → missing
      const fetchSpy = jest.spyOn(service as any, 'fetchRouteGeometry');
      await callHandlePublicTracking(service, 50.45, 30.52);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('skips route recalc when courier is within deviation threshold (< 50m)', async () => {
      // Same coordinates as origin → 0m distance → below threshold
      const origin = JSON.stringify({ lat: 50.45, lng: 30.52 });
      mockRedis.get
        .mockResolvedValueOnce(activeOrderCache) // courier:active_order
        .mockResolvedValueOnce(origin); // route:origin
      const fetchSpy = jest.spyOn(service as any, 'fetchRouteGeometry');
      await callHandlePublicTracking(service, 50.45, 30.52);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('skips route recalc when cooldown key exists (NX EX returns null)', async () => {
      // Position far from origin (> 50m)
      const origin = JSON.stringify({ lat: 49.0, lng: 29.0 });
      mockRedis.get
        .mockResolvedValueOnce(activeOrderCache) // courier:active_order
        .mockResolvedValueOnce(origin); // route:origin
      // NX EX fails → cooldown already set
      mockRedis.set = jest.fn().mockResolvedValue(null);
      const fetchSpy = jest.spyOn(service as any, 'fetchRouteGeometry');
      await callHandlePublicTracking(service, 50.45, 30.52);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('recalculates route, caches it, and publishes when deviation > 50m and no cooldown', async () => {
      const origin = JSON.stringify({ lat: 49.0, lng: 29.0 });
      const fakeRoute = { type: 'LineString', coordinates: [[30.52, 50.45]] };
      mockRedis.get
        .mockResolvedValueOnce(activeOrderCache) // courier:active_order
        .mockResolvedValueOnce(origin); // route:origin
      mockRedis.set = jest.fn().mockResolvedValue('OK'); // NX EX acquired
      jest
        .spyOn(service as any, 'fetchRouteGeometry')
        .mockResolvedValue(fakeRoute);

      await callHandlePublicTracking(service, 50.45, 30.52);

      // Route published to WS channel
      expect(mockRedis.publish).toHaveBeenCalledWith(
        `order:${orderId}:public`,
        expect.stringContaining('"type":"route"'),
      );
      // Route cached with 4h TTL
      expect(mockRedis.set).toHaveBeenCalledWith(
        `route:${deliveryId}`,
        expect.any(String),
        'EX',
        4 * 3600,
      );
      // Origin key updated with 4h TTL
      expect(mockRedis.set).toHaveBeenCalledWith(
        `route:origin:${deliveryId}`,
        expect.any(String),
        'EX',
        4 * 3600,
      );
    });

    it('does NOT cache or publish route when fetchRouteGeometry returns null', async () => {
      const origin = JSON.stringify({ lat: 49.0, lng: 29.0 });
      mockRedis.get
        .mockResolvedValueOnce(activeOrderCache)
        .mockResolvedValueOnce(origin);
      mockRedis.set = jest.fn().mockResolvedValue('OK');
      jest.spyOn(service as any, 'fetchRouteGeometry').mockResolvedValue(null);

      await callHandlePublicTracking(service, 50.45, 30.52);

      expect(mockRedis.set).toHaveBeenCalledTimes(1); // only the NX EX cooldown set
      // Route NOT published
      const routePublish = mockRedis.publish.mock.calls.find((c) =>
        String(c[1]).includes('"type":"route"'),
      );
      expect(routePublish).toBeUndefined();
    });
  });

  // ── clearActiveOrder ────────────────────────────────────────────────────────

  describe('clearActiveOrder', () => {
    beforeEach(() => {
      mockRedis.del = jest.fn().mockResolvedValue(1);
    });

    it('DELs active_order, route:origin, and route keys', async () => {
      await service.clearActiveOrder('c1', 'del-1');
      expect(mockRedis.del).toHaveBeenCalledWith('courier:active_order:c1');
      expect(mockRedis.del).toHaveBeenCalledWith('route:origin:del-1');
      expect(mockRedis.del).toHaveBeenCalledWith('route:del-1');
    });
  });

  describe('getLastKnownPosition', () => {
    it('returns null when no cached position', async () => {
      mockPrisma.courier.findUnique.mockResolvedValue(courierA);
      mockRedis.get.mockResolvedValue(null);
      const result = await service.getLastKnownPosition('c1', EST_A);
      expect(result).toBeNull();
    });

    it('returns parsed position from Redis', async () => {
      mockPrisma.courier.findUnique.mockResolvedValue(courierA);
      mockRedis.get.mockResolvedValue(
        JSON.stringify({ lat: 50.45, lng: 30.52, battery: 80, ts: 1000 }),
      );
      const result = await service.getLastKnownPosition('c1', EST_A);
      expect(result?.lat).toBe(50.45);
    });

    it('rejects access to courier from another establishment', async () => {
      mockPrisma.courier.findUnique.mockResolvedValue(courierB);
      await expect(service.getLastKnownPosition('c2', EST_A)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
