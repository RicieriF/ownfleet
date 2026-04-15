import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { getQueueToken } from '@nestjs/bull';
import { OrdersService } from '../orders.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { WebhooksService } from '../../webhooks/webhooks.service.js';
import { TelegramService } from '../../telegram/telegram.service.js';
import { EtaService } from '../../eta/eta.service.js';
import { TrackingGateway } from '../../tracking/tracking.gateway.js';
import { TrackingService } from '../../tracking/tracking.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { CouriersService } from '../../couriers/couriers.service.js';
import { REDIS_CLIENT } from '../../shared/redis/redis.constants.js';

const EST_A = 'est-a';
const EST_B = 'est-b';

const manager: any = { id: 'u1', establishment_id: EST_A, role: 'manager' };
const dispatcher: any = {
  id: 'u2',
  establishment_id: EST_A,
  role: 'dispatcher',
};

const pendingOrder = {
  id: 'o1',
  establishment_id: EST_A,
  status: 'pending',
  external_id: null,
};
const orderEstB = {
  id: 'o2',
  establishment_id: EST_B,
  status: 'pending',
  external_id: null,
};
const assignedOrder = {
  id: 'o3',
  establishment_id: EST_A,
  status: 'assigned',
  external_id: null,
};
const completedOrder = {
  id: 'o4',
  establishment_id: EST_A,
  status: 'completed',
  external_id: null,
};

const courierA = {
  id: 'c1',
  establishment_id: EST_A,
  name: 'Ivan',
  transport_mode: 'moto_electric',
};

const mockTx = {
  order: {
    update: jest.fn().mockResolvedValue(assignedOrder),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    findUniqueOrThrow: jest.fn().mockResolvedValue(assignedOrder),
  },
  delivery: { create: jest.fn().mockResolvedValue({}) },
};

const mockEstablishment = { lat: 50.45, lng: 30.52, timezone: 'Europe/Kyiv' };

const mockDelivery = {
  id: 'd1',
  courier_id: 'c1',
  order_id: 'o1',
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
  establishment: {
    findUniqueOrThrow: jest.fn().mockResolvedValue(mockEstablishment),
    findUnique: jest.fn().mockResolvedValue({ dispatch_mode: 'manual' }),
  },
  delivery: {
    findFirst: jest.fn().mockResolvedValue(mockDelivery),
  },
  $transaction: jest.fn((cb: any) => cb(mockTx)),
};

const mockTelegramService = {
  notifyEstablishmentManagers: jest.fn().mockResolvedValue(undefined),
  notifyCourier: jest.fn().mockResolvedValue(undefined),
};

const mockWebhooksService = {
  dispatch: jest.fn().mockResolvedValue(undefined),
};
const mockEtaService = { calculateEta: jest.fn().mockResolvedValue(900) };
const mockGateway = { broadcastToEstablishment: jest.fn() };
const mockNotificationsService = {
  sendPush: jest.fn().mockResolvedValue(undefined),
};
const mockCouriersService = {
  invalidateWorkloadCache: jest.fn().mockResolvedValue(undefined),
};

describe('OrdersService', () => {
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
        {
          provide: getQueueToken('dispatch'),
          useValue: { add: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: REDIS_CLIENT,
          useValue: { publish: jest.fn().mockResolvedValue(1) },
        },
      ],
    }).compile();
    service = module.get<OrdersService>(OrdersService);
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((cb: any) => cb(mockTx));
    mockTx.order.update.mockResolvedValue(assignedOrder);
    mockTx.order.updateMany.mockResolvedValue({ count: 1 });
    mockTx.order.findUniqueOrThrow.mockResolvedValue(assignedOrder);
    mockTx.delivery.create.mockResolvedValue({});
  });

  describe('multi-tenant isolation', () => {
    it('findOne rejects order from another establishment', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(orderEstB);
      await expect(service.findOne('o2', manager)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('assign rejects order from another establishment', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(orderEstB);
      await expect(
        service.assign('o2', { courier_id: 'c1' }, manager),
      ).rejects.toThrow(ForbiddenException);
    });

    it('cancel rejects order from another establishment', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(orderEstB);
      await expect(service.cancel('o2', manager)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('state machine enforcement', () => {
    it('cannot assign an already assigned order', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(assignedOrder);
      mockPrisma.courier.findUnique.mockResolvedValue(courierA);
      await expect(
        service.assign('o3', { courier_id: 'c1' }, manager),
      ).rejects.toThrow(BadRequestException);
    });

    it('cannot cancel a completed order', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(completedOrder);
      await expect(service.cancel('o4', manager)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('assigns pending order successfully', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(pendingOrder);
      mockPrisma.courier.findUnique.mockResolvedValue(courierA);

      const result = await service.assign('o1', { courier_id: 'c1' }, manager);
      expect(result.status).toBe('assigned');
      expect(mockTx.delivery.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('idempotency', () => {
    it('returns existing order for duplicate external_id', async () => {
      const existing = { ...pendingOrder, external_id: 'EXT-001' };
      mockPrisma.order.findFirst.mockResolvedValue(existing);

      const result = await service.create(
        { address: 'вул. Хрещатик 1', external_id: 'EXT-001' },
        manager,
      );

      expect(result).toEqual(existing);
      expect(mockPrisma.order.create).not.toHaveBeenCalled();
    });

    it('creates new order when no duplicate', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(null);
      mockPrisma.order.create.mockResolvedValue(pendingOrder);

      await service.create(
        { address: 'вул. Хрещатик 1', external_id: 'EXT-002' },
        manager,
      );
      expect(mockPrisma.order.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('RBAC', () => {
    it('dispatcher cannot assign order', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(pendingOrder);
      await expect(
        service.assign('o1', { courier_id: 'c1' }, dispatcher),
      ).rejects.toThrow(ForbiddenException);
    });

    it('dispatcher cannot cancel order', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(pendingOrder);
      await expect(service.cancel('o1', dispatcher)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('courier cross-tenant', () => {
    it('cannot assign courier from another establishment', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(pendingOrder);
      mockPrisma.courier.findUnique.mockResolvedValue({
        id: 'c2',
        establishment_id: EST_B,
      });
      await expect(
        service.assign('o1', { courier_id: 'c2' }, manager),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('Telegram notifications', () => {
    it('create() fires order_created to establishment managers', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(null);
      mockPrisma.order.create.mockResolvedValue(pendingOrder);

      await service.create({ address: 'вул. Хрещатик 1' }, manager);

      expect(
        mockTelegramService.notifyEstablishmentManagers,
      ).toHaveBeenCalledWith(EST_A, expect.any(String), 'order_created');
    });

    it('assign() fires delivery_assigned to establishment managers', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(pendingOrder);
      mockPrisma.courier.findUnique.mockResolvedValue(courierA);

      await service.assign('o1', { courier_id: 'c1' }, manager);

      expect(
        mockTelegramService.notifyEstablishmentManagers,
      ).toHaveBeenCalledWith(EST_A, expect.any(String), 'delivery_assigned');
    });

    it('assign() fires delivery_assigned to the courier', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(pendingOrder);
      mockPrisma.courier.findUnique.mockResolvedValue(courierA);

      await service.assign('o1', { courier_id: 'c1' }, manager);

      expect(mockTelegramService.notifyCourier).toHaveBeenCalledWith(
        'c1',
        expect.any(String),
        'delivery_assigned',
      );
    });
  });

  // ── getAvailable ──────────────────────────────────────────────────────────

  describe('getAvailable', () => {
    const courierUser: any = {
      id: 'user-1',
      establishment_id: EST_A,
      role: 'courier',
      courier_id: 'courier-1',
      is_platform_admin: false,
    };

    const estWithDispatch = {
      dispatch_mode: 'auto',
      lat: 50.45,
      lng: 30.52,
      timezone: 'Europe/Kyiv',
    };

    const activeShift = {
      id: 'shift-1',
      courier_id: 'courier-1',
      establishment_id: EST_A,
      ended_at: null,
    };

    const availableOrders = [
      {
        id: 'order-1',
        address: 'вул. Хрещатик 1',
        lat: 50.44,
        lng: 30.51,
        notes: null,
        created_at: new Date(),
      },
    ];

    it('happy path: dispatch_mode=auto, courier on shift → returns pending orders', async () => {
      mockPrisma.establishment.findUniqueOrThrow.mockResolvedValue(
        estWithDispatch,
      );
      mockPrisma.shift.findFirst.mockResolvedValue(activeShift);
      mockPrisma.order.findMany.mockResolvedValue(availableOrders);

      const result = await service.getAvailable(courierUser);

      expect(result).toEqual(availableOrders);
      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { establishment_id: EST_A, status: 'pending' },
        }),
      );
    });

    it("multi-tenant: findMany is scoped to the courier's establishment only", async () => {
      mockPrisma.establishment.findUniqueOrThrow.mockResolvedValue(
        estWithDispatch,
      );
      mockPrisma.shift.findFirst.mockResolvedValue(activeShift);
      mockPrisma.order.findMany.mockResolvedValue(availableOrders);

      await service.getAvailable(courierUser);

      const callArgs = mockPrisma.order.findMany.mock.calls[0][0];
      expect(callArgs.where.establishment_id).toBe(EST_A);
      expect(callArgs.where.establishment_id).not.toBe(EST_B);
    });

    it('throws BadRequestException when dispatch_mode=manual', async () => {
      mockPrisma.establishment.findUniqueOrThrow.mockResolvedValue({
        ...estWithDispatch,
        dispatch_mode: 'manual',
      });
      mockPrisma.shift.findFirst.mockResolvedValue(activeShift);

      await expect(service.getAvailable(courierUser)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.order.findMany).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when courier has no active shift', async () => {
      mockPrisma.establishment.findUniqueOrThrow.mockResolvedValue(
        estWithDispatch,
      );
      mockPrisma.shift.findFirst.mockResolvedValue(null);

      await expect(service.getAvailable(courierUser)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.order.findMany).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when user has no courier_id', async () => {
      const nonCourierUser: any = {
        id: 'user-2',
        establishment_id: EST_A,
        role: 'manager',
        courier_id: undefined,
        is_platform_admin: false,
      };
      // fetchEstablishmentForDispatch will succeed but assertCourierOnShift checks courier_id first
      mockPrisma.establishment.findUniqueOrThrow.mockResolvedValue(
        estWithDispatch,
      );

      await expect(service.getAvailable(nonCourierUser)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrisma.order.findMany).not.toHaveBeenCalled();
    });
  });

  // ── claim ─────────────────────────────────────────────────────────────────

  describe('claim', () => {
    const courierUser: any = {
      id: 'user-1',
      establishment_id: EST_A,
      role: 'courier',
      courier_id: 'courier-1',
      is_platform_admin: false,
    };

    const estWithDispatch = {
      dispatch_mode: 'auto',
      lat: 50.45,
      lng: 30.52,
      timezone: 'Europe/Kyiv',
    };

    const activeShift = {
      id: 'shift-1',
      courier_id: 'courier-1',
      establishment_id: EST_A,
      ended_at: null,
    };

    const mockOrder = {
      id: 'order-1',
      establishment_id: EST_A,
      address: 'вул. Хрещатик 1',
      lat: 50.44,
      lng: 30.51,
      status: 'pending' as const,
    };

    const mockCourier = {
      name: 'Ivan',
      transport_mode: 'moto_electric',
    };

    const claimedOrder = { ...mockOrder, status: 'assigned' as const };

    // mockTx2 is set up fresh before each claim test so that claim()'s $transaction
    // gets a tx object with updateMany/findUniqueOrThrow (different from the assign() tx).
    let mockTx2: {
      order: { updateMany: jest.Mock; findUniqueOrThrow: jest.Mock };
      delivery: { create: jest.Mock };
    };

    beforeEach(() => {
      mockEtaService.calculateEta.mockResolvedValue(600);
      mockTx2 = {
        order: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUniqueOrThrow: jest.fn().mockResolvedValue(claimedOrder),
        },
        delivery: { create: jest.fn().mockResolvedValue({}) },
      };
      mockPrisma.$transaction.mockImplementation((cb: any) => cb(mockTx2));
    });

    it('happy path: dispatch_mode=auto, courier on shift, pending order → returns claimed order', async () => {
      mockPrisma.establishment.findUniqueOrThrow.mockResolvedValue(
        estWithDispatch,
      );
      mockPrisma.shift.findFirst.mockResolvedValue(activeShift);
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      mockPrisma.courier.findUniqueOrThrow.mockResolvedValue(mockCourier);

      const result = await service.claim('order-1', courierUser);

      expect(result).toEqual(claimedOrder);
      expect(mockTx2.order.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order-1', status: 'pending' },
        }),
      );
      expect(mockTx2.delivery.create).toHaveBeenCalledTimes(1);
      expect(mockTx2.delivery.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            order_id: 'order-1',
            courier_id: 'courier-1',
            status: 'assigned',
          }),
        }),
      );
    });

    it('happy path: ETA is calculated when all coordinates and transport_mode are set', async () => {
      mockPrisma.establishment.findUniqueOrThrow.mockResolvedValue(
        estWithDispatch,
      );
      mockPrisma.shift.findFirst.mockResolvedValue(activeShift);
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      mockPrisma.courier.findUniqueOrThrow.mockResolvedValue(mockCourier);

      await service.claim('order-1', courierUser);

      expect(mockEtaService.calculateEta).toHaveBeenCalledWith(
        expect.objectContaining({
          establishmentLat: estWithDispatch.lat,
          establishmentLng: estWithDispatch.lng,
          orderLat: mockOrder.lat,
          orderLng: mockOrder.lng,
          transportMode: mockCourier.transport_mode,
        }),
      );
      expect(mockTx2.delivery.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ eta_seconds: 600 }),
        }),
      );
    });

    it('ETA is skipped when establishment coordinates are null', async () => {
      mockPrisma.establishment.findUniqueOrThrow.mockResolvedValue({
        ...estWithDispatch,
        lat: null,
        lng: null,
      });
      mockPrisma.shift.findFirst.mockResolvedValue(activeShift);
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      mockPrisma.courier.findUniqueOrThrow.mockResolvedValue(mockCourier);

      await service.claim('order-1', courierUser);

      expect(mockEtaService.calculateEta).not.toHaveBeenCalled();
      expect(mockTx2.delivery.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ eta_seconds: expect.anything() }),
        }),
      );
    });

    it('ETA is skipped when order coordinates are null', async () => {
      mockPrisma.establishment.findUniqueOrThrow.mockResolvedValue(
        estWithDispatch,
      );
      mockPrisma.shift.findFirst.mockResolvedValue(activeShift);
      mockPrisma.order.findUnique.mockResolvedValue({
        ...mockOrder,
        lat: null,
        lng: null,
      });
      mockPrisma.courier.findUniqueOrThrow.mockResolvedValue(mockCourier);

      await service.claim('order-1', courierUser);

      expect(mockEtaService.calculateEta).not.toHaveBeenCalled();
    });

    it('ETA is skipped when courier transport_mode is null', async () => {
      mockPrisma.establishment.findUniqueOrThrow.mockResolvedValue(
        estWithDispatch,
      );
      mockPrisma.shift.findFirst.mockResolvedValue(activeShift);
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      mockPrisma.courier.findUniqueOrThrow.mockResolvedValue({
        ...mockCourier,
        transport_mode: null,
      });

      await service.claim('order-1', courierUser);

      expect(mockEtaService.calculateEta).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when user has no courier_id', async () => {
      const nonCourierUser: any = {
        id: 'user-2',
        establishment_id: EST_A,
        role: 'manager',
        courier_id: undefined,
        is_platform_admin: false,
      };

      await expect(service.claim('order-1', nonCourierUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws BadRequestException when dispatch_mode=manual', async () => {
      mockPrisma.establishment.findUniqueOrThrow.mockResolvedValue({
        ...estWithDispatch,
        dispatch_mode: 'manual',
      });
      mockPrisma.shift.findFirst.mockResolvedValue(activeShift);

      await expect(service.claim('order-1', courierUser)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException when order does not exist', async () => {
      mockPrisma.establishment.findUniqueOrThrow.mockResolvedValue(
        estWithDispatch,
      );
      mockPrisma.shift.findFirst.mockResolvedValue(activeShift);
      mockPrisma.order.findUnique.mockResolvedValue(null);

      await expect(service.claim('order-1', courierUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when order belongs to different establishment', async () => {
      mockPrisma.establishment.findUniqueOrThrow.mockResolvedValue(
        estWithDispatch,
      );
      mockPrisma.shift.findFirst.mockResolvedValue(activeShift);
      mockPrisma.order.findUnique.mockResolvedValue({
        ...mockOrder,
        establishment_id: EST_B,
      });

      await expect(service.claim('order-1', courierUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when order status is not pending', async () => {
      mockPrisma.establishment.findUniqueOrThrow.mockResolvedValue(
        estWithDispatch,
      );
      mockPrisma.shift.findFirst.mockResolvedValue(activeShift);
      mockPrisma.order.findUnique.mockResolvedValue({
        ...mockOrder,
        status: 'assigned',
      });

      await expect(service.claim('order-1', courierUser)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws ConflictException with race-condition message when updateMany returns count=0', async () => {
      mockPrisma.establishment.findUniqueOrThrow.mockResolvedValue(
        estWithDispatch,
      );
      mockPrisma.shift.findFirst.mockResolvedValue(activeShift);
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      mockPrisma.courier.findUniqueOrThrow.mockResolvedValue(mockCourier);
      mockTx2.order.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.claim('order-1', courierUser)).rejects.toThrow(
        new ConflictException(
          'Order has already been claimed by another courier',
        ),
      );
    });

    it('fires Telegram notifications to managers and courier (fire-and-forget)', async () => {
      mockPrisma.establishment.findUniqueOrThrow.mockResolvedValue(
        estWithDispatch,
      );
      mockPrisma.shift.findFirst.mockResolvedValue(activeShift);
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      mockPrisma.courier.findUniqueOrThrow.mockResolvedValue(mockCourier);

      await service.claim('order-1', courierUser);

      expect(
        mockTelegramService.notifyEstablishmentManagers,
      ).toHaveBeenCalledWith(EST_A, expect.any(String), 'delivery_assigned');
      expect(mockTelegramService.notifyCourier).toHaveBeenCalledWith(
        'courier-1',
        expect.any(String),
        'delivery_assigned',
      );
    });

    it('fires order.assigned webhook (fire-and-forget)', async () => {
      mockPrisma.establishment.findUniqueOrThrow.mockResolvedValue(
        estWithDispatch,
      );
      mockPrisma.shift.findFirst.mockResolvedValue(activeShift);
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      mockPrisma.courier.findUniqueOrThrow.mockResolvedValue(mockCourier);

      await service.claim('order-1', courierUser);

      expect(mockWebhooksService.dispatch).toHaveBeenCalledWith(
        EST_A,
        'order.assigned',
        { order_id: 'order-1' },
      );
    });

    it('broadcasts order:assigned WS event to establishment room', async () => {
      mockPrisma.establishment.findUniqueOrThrow.mockResolvedValue(
        estWithDispatch,
      );
      mockPrisma.shift.findFirst.mockResolvedValue(activeShift);
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      mockPrisma.courier.findUniqueOrThrow.mockResolvedValue(mockCourier);

      await service.claim('order-1', courierUser);

      expect(mockGateway.broadcastToEstablishment).toHaveBeenCalledWith(
        EST_A,
        'order:assigned',
        { order_id: 'order-1' },
      );
    });
  });
});
