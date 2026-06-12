import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { getQueueToken } from '@nestjs/bull';
import { OrdersService } from '../orders.service.js';
import { DispatchProcessor } from '../dispatch.processor.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { WebhooksService } from '../../webhooks/webhooks.service.js';
import { TelegramService } from '../../telegram/telegram.service.js';
import { EtaService } from '../../eta/eta.service.js';
import { TrackingGateway } from '../../tracking/tracking.gateway.js';
import { TrackingService } from '../../tracking/tracking.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { CouriersService } from '../../couriers/couriers.service.js';
import { REDIS_CLIENT } from '../../shared/redis/redis.constants.js';
import { GeocodingService } from '../../geocoding/geocoding.service.js';

const EST_A = 'est-a';

const manager: any = { id: 'u1', establishment_id: EST_A, role: 'manager' };
const dispatcher: any = {
  id: 'u2',
  establishment_id: EST_A,
  role: 'dispatcher',
};

// Order fixtures
const pendingOrder = {
  id: 'order-1',
  establishment_id: EST_A,
  status: 'pending',
  address: 'вул. Хрещатик 1',
  lat: 50.44,
  lng: 30.51,
  external_id: null,
};
const assignedOrder = {
  id: 'order-2',
  establishment_id: EST_A,
  status: 'assigned',
  address: 'вул. Хрещатик 2',
  lat: 50.44,
  lng: 30.51,
  external_id: null,
};
const completedOrder = {
  id: 'order-3',
  establishment_id: EST_A,
  status: 'completed',
  address: 'вул. Хрещатик 3',
  lat: 50.44,
  lng: 30.51,
  external_id: null,
};

// Courier row returned by $queryRaw (WorkloadRow shape)
const makeWorkloadRow = (distanceMeters: number) => ({
  courier_id: 'c1',
  name: 'Ivan',
  transport_mode: 'moto_electric',
  workload_score: '0',
  deliveries_count: '0',
  distance_meters: String(distanceMeters),
});

const courierA = {
  id: 'c1',
  establishment_id: EST_A,
  name: 'Ivan',
  transport_mode: 'moto_electric',
};

const estWithAuto = {
  id: EST_A,
  lat: 50.45,
  lng: 30.52,
  timezone: 'Europe/Kyiv',
  dispatch_mode: 'auto',
};
const estWithRecommend = {
  ...estWithAuto,
  dispatch_mode: 'recommend',
};
const mockDispatchQueue = { add: jest.fn().mockResolvedValue(undefined) };

const mockTx = {
  order: {
    update: jest.fn().mockResolvedValue(assignedOrder),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    findUniqueOrThrow: jest.fn().mockResolvedValue(assignedOrder),
  },
  delivery: { create: jest.fn().mockResolvedValue({}) },
};

const mockPrisma = {
  order: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  courier: {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
  },
  shift: {
    findFirst: jest.fn(),
  },
  delivery: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  establishment: {
    findUniqueOrThrow: jest.fn().mockResolvedValue(estWithAuto),
    findUnique: jest.fn().mockResolvedValue(estWithAuto),
  },
  $transaction: jest.fn((cb: any) => cb(mockTx)),
  $queryRaw: jest.fn(),
};

const mockTelegramService = {
  notifyEstablishmentManagers: jest.fn().mockResolvedValue(undefined),
  notifyCourier: jest.fn().mockResolvedValue(undefined),
};

const mockWebhooksService = {
  dispatch: jest.fn().mockResolvedValue(undefined),
};
const mockEtaService = { calculateEta: jest.fn().mockResolvedValue(300) };
const mockGateway = { broadcastToEstablishment: jest.fn() };
const mockNotificationsService = {
  sendPush: jest.fn().mockResolvedValue(undefined),
};
const mockCouriersService = {
  invalidateWorkloadCache: jest.fn().mockResolvedValue(undefined),
};
const mockGeocodingService = {
  enqueueGeocode: jest.fn().mockResolvedValue(undefined),
};

// ── OrdersService dispatch tests ─────────────────────────────────────────────

describe('OrdersService — dispatch algorithm', () => {
  let service: OrdersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: WebhooksService, useValue: mockWebhooksService },
        { provide: TelegramService, useValue: mockTelegramService },
        { provide: EtaService, useValue: mockEtaService },
        { provide: TrackingGateway, useValue: mockGateway },
        {
          provide: TrackingService,
          useValue: {
            setActiveOrder: jest.fn().mockResolvedValue(undefined),
            clearActiveOrder: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: CouriersService, useValue: mockCouriersService },
        { provide: GeocodingService, useValue: mockGeocodingService },
        { provide: getQueueToken('dispatch'), useValue: mockDispatchQueue },
        {
          provide: REDIS_CLIENT,
          useValue: { publish: jest.fn().mockResolvedValue(1) },
        },
      ],
    }).compile();
    service = module.get<OrdersService>(OrdersService);
    jest.clearAllMocks();

    // Reset defaults
    mockPrisma.$transaction.mockImplementation((cb: any) => cb(mockTx));
    mockTx.order.update.mockResolvedValue(assignedOrder);
    mockTx.order.updateMany.mockResolvedValue({ count: 1 });
    mockTx.order.findUniqueOrThrow.mockResolvedValue(assignedOrder);
    mockTx.delivery.create.mockResolvedValue({});
    mockEtaService.calculateEta.mockResolvedValue(300);
    mockGateway.broadcastToEstablishment.mockReturnValue(undefined);
  });

  // ── Group 1: runDispatchAlgorithm ──────────────────────────────────────────

  describe('runDispatchAlgorithm', () => {
    it('dispatch_mode=auto, Zone 1 courier available → assigns immediately', async () => {
      // Zone 1: distance < 150m
      mockPrisma.order.findUnique.mockResolvedValue(pendingOrder);
      mockPrisma.establishment.findUnique.mockResolvedValue(estWithAuto);
      mockPrisma.$queryRaw.mockResolvedValue([makeWorkloadRow(100)]);
      mockEtaService.calculateEta.mockResolvedValue(300);

      // assignCourier will call findUnique for order, courier, establishment
      mockPrisma.courier.findUnique.mockResolvedValue(courierA);
      mockPrisma.establishment.findUniqueOrThrow.mockResolvedValue(estWithAuto);

      const result = await service.runDispatchAlgorithm('order-1', EST_A);

      expect('recommended' in result).toBe(true);
      if ('recommended' in result) {
        expect(result.recommended.courierId).toBe('c1');
      }
    });

    it('dispatch_mode=auto, no couriers available → returns { waiting: true }', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(pendingOrder);
      mockPrisma.establishment.findUnique.mockResolvedValue(estWithAuto);
      mockPrisma.$queryRaw.mockResolvedValue([]);

      const result = await service.runDispatchAlgorithm('order-1', EST_A);

      expect(result).toEqual({ waiting: true });
    });

    it('dispatch_mode=recommend, courier found → returns recommended without auto-assigning', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(pendingOrder);
      mockPrisma.establishment.findUnique.mockResolvedValue(estWithRecommend);
      mockPrisma.$queryRaw.mockResolvedValue([makeWorkloadRow(500)]);
      mockEtaService.calculateEta.mockResolvedValue(300);

      const result = await service.runDispatchAlgorithm('order-1', EST_A);

      expect('recommended' in result).toBe(true);
      if ('recommended' in result) {
        expect(result.recommended.courierId).toBe('c1');
        expect(result.recommended.name).toBe('Ivan');
        expect(result.recommended.etaSeconds).toBe(300);
      }
      // Should NOT call assignCourier ($transaction not called for assignment)
      expect(mockTx.order.update).not.toHaveBeenCalled();
    });

    it('establishment missing coordinates → returns { waiting: true }', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(pendingOrder);
      mockPrisma.establishment.findUnique.mockResolvedValue({
        ...estWithAuto,
        lat: null,
        lng: null,
      });

      const result = await service.runDispatchAlgorithm('order-1', EST_A);

      expect(result).toEqual({ waiting: true });
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('order not found → throws NotFoundException', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      mockPrisma.establishment.findUnique.mockResolvedValue(estWithAuto);

      await expect(
        service.runDispatchAlgorithm('nonexistent', EST_A),
      ).rejects.toThrow(NotFoundException);
    });

    it('OSRM fails for all couriers → returns { error: eta_unavailable, canRetry: true }', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(pendingOrder);
      mockPrisma.establishment.findUnique.mockResolvedValue(estWithAuto);
      mockPrisma.$queryRaw.mockResolvedValue([makeWorkloadRow(100)]);
      mockEtaService.calculateEta.mockRejectedValue(
        new Error('OSRM unavailable'),
      );

      const result = await service.runDispatchAlgorithm('order-1', EST_A);

      expect(result).toEqual({ error: 'eta_unavailable', canRetry: true });
    });

    it('Zone 2 courier when Zone 1 empty → assigns Zone 2 courier', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(pendingOrder);
      mockPrisma.establishment.findUnique.mockResolvedValue(estWithAuto);
      // Zone 2: distance 600m (> 150m but < 1000m)
      mockPrisma.$queryRaw.mockResolvedValue([makeWorkloadRow(600)]);
      mockEtaService.calculateEta.mockResolvedValue(400);

      // assignCourier dependencies
      mockPrisma.courier.findUnique.mockResolvedValue(courierA);
      mockPrisma.establishment.findUniqueOrThrow.mockResolvedValue(estWithAuto);

      const result = await service.runDispatchAlgorithm('order-1', EST_A);

      expect('recommended' in result).toBe(true);
      if ('recommended' in result) {
        expect(result.recommended.courierId).toBe('c1');
        expect(result.recommended.distanceMeters).toBe(600);
      }
    });

    it('two couriers, OSRM throws on first but succeeds for second → assigns second courier', async () => {
      // Both couriers in zone1 (< 150m) so both end up in candidates.
      // ETA is deduplicated by transport_mode, so couriers need distinct modes
      // to exercise per-courier OSRM divergence (one call per unique mode).
      const row1 = makeWorkloadRow(100);
      const row2 = {
        ...makeWorkloadRow(120),
        courier_id: 'c2',
        name: 'Petro',
        transport_mode: 'bicycle',
      };

      mockPrisma.order.findUnique.mockResolvedValue(pendingOrder);
      mockPrisma.establishment.findUnique.mockResolvedValue(estWithAuto);
      mockPrisma.$queryRaw.mockResolvedValue([row1, row2]);
      // Promise.allSettled: first mode fails, second succeeds → second courier wins
      mockEtaService.calculateEta
        .mockRejectedValueOnce(new Error('OSRM timeout'))
        .mockResolvedValueOnce(400);

      // assignCourier dependencies for auto-assign of c2
      mockPrisma.courier.findUnique.mockResolvedValue({
        ...courierA,
        id: 'c2',
        name: 'Petro',
      });
      mockPrisma.establishment.findUniqueOrThrow.mockResolvedValue(estWithAuto);

      const result = await service.runDispatchAlgorithm('order-1', EST_A);

      // With Promise.allSettled, the surviving courier (c2) is still assigned
      expect('recommended' in result).toBe(true);
      if ('recommended' in result) {
        expect(result.recommended.courierId).toBe('c2');
        expect(result.recommended.etaSeconds).toBe(400);
      }
    });

    it('two couriers, OSRM throws for ALL → returns { error: eta_unavailable }', async () => {
      // Both couriers in zone1 (< 150m) so both are in candidates
      const row1 = makeWorkloadRow(100);
      const row2 = { ...makeWorkloadRow(120), courier_id: 'c2', name: 'Petro' };

      mockPrisma.order.findUnique.mockResolvedValue(pendingOrder);
      mockPrisma.establishment.findUnique.mockResolvedValue(estWithAuto);
      mockPrisma.$queryRaw.mockResolvedValue([row1, row2]);
      // Both couriers share one transport_mode → ETA dedup makes a single OSRM call
      mockEtaService.calculateEta.mockRejectedValueOnce(
        new Error('OSRM timeout'),
      );

      const result = await service.runDispatchAlgorithm('order-1', EST_A);

      expect(result).toEqual({ error: 'eta_unavailable', canRetry: true });
    });
  });

  // ── Group 2: markReady ─────────────────────────────────────────────────────

  describe('markReady', () => {
    it('pending order → sets ready_at and broadcasts order:ready WS event', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(pendingOrder);
      mockPrisma.order.update.mockResolvedValue({
        ...pendingOrder,
        ready_at: new Date(),
      });

      await service.markReady('order-1', manager);

      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order-1' },
          data: expect.objectContaining({ ready_at: expect.any(Date) }),
        }),
      );
      expect(mockGateway.broadcastToEstablishment).toHaveBeenCalledWith(
        EST_A,
        'order:ready',
        expect.objectContaining({
          orderId: 'order-1',
          readyAt: expect.any(Date),
        }),
      );
    });

    it('assigned order → also sets ready_at without throwing', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(assignedOrder);
      mockPrisma.order.update.mockResolvedValue({
        ...assignedOrder,
        ready_at: new Date(),
      });

      await expect(
        service.markReady('order-2', manager),
      ).resolves.not.toThrow();

      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ready_at: expect.any(Date) }),
        }),
      );
    });

    it('completed order → throws ConflictException', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(completedOrder);

      await expect(service.markReady('order-3', manager)).rejects.toThrow(
        ConflictException,
      );
    });

    it('dispatcher user → throws ForbiddenException', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(pendingOrder);

      await expect(service.markReady('order-1', dispatcher)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ── Group 3: assignRecommended ─────────────────────────────────────────────

  describe('assignRecommended', () => {
    beforeEach(() => {
      mockPrisma.order.findUnique.mockResolvedValue(pendingOrder);
      mockPrisma.courier.findUnique.mockResolvedValue(courierA);
      mockPrisma.establishment.findUniqueOrThrow.mockResolvedValue(estWithAuto);
      mockTx.order.updateMany.mockResolvedValue({ count: 1 });
      mockTx.order.findUniqueOrThrow.mockResolvedValue(assignedOrder);
      mockPrisma.$transaction.mockImplementation((cb: any) => cb(mockTx));
    });

    it('pending order + valid courier → assigns with race protection', async () => {
      const result = await service.assignRecommended('order-1', 'c1', manager);

      expect(mockTx.order.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order-1', status: 'pending' },
          data: { status: 'assigned' },
        }),
      );
      expect(mockTx.delivery.create).toHaveBeenCalledTimes(1);
      expect(mockWebhooksService.dispatch).toHaveBeenCalledWith(
        EST_A,
        'order.assigned',
        { order_id: 'order-1' },
      );
      expect(mockCouriersService.invalidateWorkloadCache).toHaveBeenCalledWith(
        EST_A,
      );
      expect(result).toEqual(assignedOrder);
    });

    it('race condition (updateMany count=0) → throws ConflictException', async () => {
      mockTx.order.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.assignRecommended('order-1', 'c1', manager),
      ).rejects.toThrow(ConflictException);
    });

    it('courier from different establishment → throws NotFoundException', async () => {
      mockPrisma.courier.findUnique.mockResolvedValue({
        ...courierA,
        establishment_id: 'est-b',
      });

      await expect(
        service.assignRecommended('order-1', 'c1', manager),
      ).rejects.toThrow(NotFoundException);
    });

    it('dispatcher cannot assign-recommended → throws ForbiddenException', async () => {
      await expect(
        service.assignRecommended('order-1', 'c1', dispatcher),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});

// ── DispatchProcessor tests ───────────────────────────────────────────────────

describe('DispatchProcessor', () => {
  let processor: DispatchProcessor;
  let mockOrdersService: { runDispatchAlgorithm: jest.Mock };
  let mockProcessorQueue: { add: jest.Mock };
  let mockProcessorGateway: { broadcastToEstablishment: jest.Mock };
  let mockProcessorPrisma: {
    establishment: { findUnique: jest.Mock };
    order: { findUnique: jest.Mock };
  };
  let mockProcessorTelegram: { notifyEstablishmentManagers: jest.Mock };

  beforeEach(async () => {
    mockOrdersService = {
      runDispatchAlgorithm: jest.fn(),
    };
    mockProcessorQueue = { add: jest.fn().mockResolvedValue(undefined) };
    mockProcessorGateway = { broadcastToEstablishment: jest.fn() };
    mockProcessorPrisma = {
      establishment: {
        findUnique: jest.fn().mockResolvedValue({ dispatch_mode: 'auto' }),
      },
      order: {
        findUnique: jest.fn().mockResolvedValue({ address: 'вул. Тестова 1' }),
      },
    };
    mockProcessorTelegram = {
      notifyEstablishmentManagers: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DispatchProcessor,
        { provide: OrdersService, useValue: mockOrdersService },
        { provide: TrackingGateway, useValue: mockProcessorGateway },
        { provide: PrismaService, useValue: mockProcessorPrisma },
        { provide: TelegramService, useValue: mockProcessorTelegram },
        { provide: getQueueToken('dispatch'), useValue: mockProcessorQueue },
      ],
    }).compile();
    processor = module.get<DispatchProcessor>(DispatchProcessor);
    jest.clearAllMocks();
    mockProcessorQueue.add.mockResolvedValue(undefined);
    mockProcessorPrisma.establishment.findUnique.mockResolvedValue({
      dispatch_mode: 'auto',
    });
    mockProcessorPrisma.order.findUnique.mockResolvedValue({
      address: 'вул. Тестова 1',
    });
    mockProcessorTelegram.notifyEstablishmentManagers.mockResolvedValue(
      undefined,
    );
    mockProcessorGateway.broadcastToEstablishment.mockReturnValue(undefined);
  });

  const makeJob = (attempt: number) =>
    ({
      data: {
        orderId: 'order-1',
        establishmentId: EST_A,
        attempt,
      },
    }) as any;

  it('assigned=true (recommended in result) → does NOT re-enqueue', async () => {
    mockOrdersService.runDispatchAlgorithm.mockResolvedValue({
      recommended: {
        courierId: 'c1',
        name: 'Ivan',
        etaSeconds: 300,
        distanceMeters: 100,
        transportMode: 'moto_electric',
        workloadSeconds: 0,
        deliveriesCount: 0,
      },
      pool: [],
    });

    await processor.handle(makeJob(1));

    expect(mockProcessorQueue.add).not.toHaveBeenCalled();
  });

  it('assigned=false (waiting), attempt < 30 → re-enqueues with delay 60000', async () => {
    mockOrdersService.runDispatchAlgorithm.mockResolvedValue({ waiting: true });

    await processor.handle(makeJob(1));

    expect(mockProcessorQueue.add).toHaveBeenCalledWith(
      { orderId: 'order-1', establishmentId: EST_A, attempt: 2 },
      { delay: 60_000, jobId: 'dispatch:order-1' },
    );
  });

  it('assigned=false, attempt = 30 (max) → does NOT re-enqueue', async () => {
    mockOrdersService.runDispatchAlgorithm.mockResolvedValue({ waiting: true });

    await processor.handle(makeJob(30));

    expect(mockProcessorQueue.add).not.toHaveBeenCalled();
  });

  it('assigned=false, attempt = 5 → sends Telegram dispatch_no_courier early alert (~5 min)', async () => {
    mockOrdersService.runDispatchAlgorithm.mockResolvedValue({ waiting: true });

    await processor.handle(makeJob(5));

    // The alert is fire-and-forget (Promise chain), so we flush the microtask queue
    await Promise.resolve();
    await Promise.resolve();

    expect(mockProcessorPrisma.order.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'order-1' } }),
    );
    expect(
      mockProcessorTelegram.notifyEstablishmentManagers,
    ).toHaveBeenCalledWith(
      EST_A,
      expect.stringContaining('Немає курʼєра'),
      'dispatch_no_courier',
    );
  });

  it('assigned=false, attempt = 30 (max exhausted) → does NOT send duplicate Telegram alert', async () => {
    mockOrdersService.runDispatchAlgorithm.mockResolvedValue({ waiting: true });

    await processor.handle(makeJob(30));

    await Promise.resolve();
    await Promise.resolve();

    expect(
      mockProcessorTelegram.notifyEstablishmentManagers,
    ).not.toHaveBeenCalled();
  });

  it('assigned=false, attempt = 1 → does NOT send Telegram alert yet', async () => {
    mockOrdersService.runDispatchAlgorithm.mockResolvedValue({ waiting: true });

    await processor.handle(makeJob(1));

    await Promise.resolve();
    await Promise.resolve();

    expect(
      mockProcessorTelegram.notifyEstablishmentManagers,
    ).not.toHaveBeenCalled();
  });

  it('recommend mode → broadcasts order:recommendation WS event', async () => {
    const recommended = {
      courierId: 'c1',
      name: 'Ivan',
      etaSeconds: 300,
      distanceMeters: 100,
      transportMode: 'moto_electric',
      workloadSeconds: 0,
      deliveriesCount: 0,
    };
    mockOrdersService.runDispatchAlgorithm.mockResolvedValue({
      recommended,
      pool: [recommended],
      dispatchMode: 'recommend',
    });

    await processor.handle(makeJob(1));

    expect(mockProcessorGateway.broadcastToEstablishment).toHaveBeenCalledWith(
      EST_A,
      'order:recommendation',
      expect.objectContaining({
        order_id: 'order-1',
        courier_id: 'c1',
        courier_name: 'Ivan',
        eta_seconds: 300,
      }),
    );
    expect(mockProcessorQueue.add).not.toHaveBeenCalled();
  });

  it('eta_unavailable result (no recommended key) → re-enqueues if attempt < 30', async () => {
    mockOrdersService.runDispatchAlgorithm.mockResolvedValue({
      error: 'eta_unavailable',
      canRetry: true,
    });

    await processor.handle(makeJob(5));

    expect(mockProcessorQueue.add).toHaveBeenCalledWith(
      { orderId: 'order-1', establishmentId: EST_A, attempt: 6 },
      { delay: 60_000, jobId: 'dispatch:order-1' },
    );
  });
});
