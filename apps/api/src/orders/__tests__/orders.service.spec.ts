import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { OrdersService } from '../orders.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { WebhooksService } from '../../webhooks/webhooks.service.js';
import { TelegramService } from '../../telegram/telegram.service.js';
import { EtaService } from '../../eta/eta.service.js';

const EST_A = 'est-a';
const EST_B = 'est-b';

const manager: any = { id: 'u1', establishment_id: EST_A, role: 'manager' };
const dispatcher: any = { id: 'u2', establishment_id: EST_A, role: 'dispatcher' };

const pendingOrder = { id: 'o1', establishment_id: EST_A, status: 'pending', external_id: null };
const orderEstB = { id: 'o2', establishment_id: EST_B, status: 'pending', external_id: null };
const assignedOrder = { id: 'o3', establishment_id: EST_A, status: 'assigned', external_id: null };
const completedOrder = { id: 'o4', establishment_id: EST_A, status: 'completed', external_id: null };

const courierA = { id: 'c1', establishment_id: EST_A, name: 'Ivan', transport_mode: 'moto_electric' };

const mockTx = {
  order: { update: jest.fn().mockResolvedValue(assignedOrder) },
  delivery: { create: jest.fn().mockResolvedValue({}) },
};

const mockEstablishment = { lat: 50.45, lng: 30.52, timezone: 'Europe/Kyiv' };

const mockPrisma = {
  order: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  courier: { findUnique: jest.fn() },
  establishment: { findUniqueOrThrow: jest.fn().mockResolvedValue(mockEstablishment) },
  $transaction: jest.fn((cb: any) => cb(mockTx)),
};

const mockTelegramService = {
  notifyEstablishmentManagers: jest.fn().mockResolvedValue(undefined),
  notifyCourier: jest.fn().mockResolvedValue(undefined),
};

describe('OrdersService', () => {
  let service: OrdersService;

  beforeEach(async () => {
    const mockWebhooksService = { dispatch: jest.fn().mockResolvedValue(undefined) };
    const mockEtaService = { calculateEta: jest.fn().mockResolvedValue(900) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: WebhooksService, useValue: mockWebhooksService },
        { provide: TelegramService, useValue: mockTelegramService },
        { provide: EtaService, useValue: mockEtaService },
      ],
    }).compile();
    service = module.get<OrdersService>(OrdersService);
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((cb: any) => cb(mockTx));
    mockTx.order.update.mockResolvedValue(assignedOrder);
    mockTx.delivery.create.mockResolvedValue({});
  });

  describe('multi-tenant isolation', () => {
    it('findOne rejects order from another establishment', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(orderEstB);
      await expect(service.findOne('o2', manager)).rejects.toThrow(ForbiddenException);
    });

    it('assign rejects order from another establishment', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(orderEstB);
      await expect(
        service.assign('o2', { courier_id: 'c1' }, manager),
      ).rejects.toThrow(ForbiddenException);
    });

    it('cancel rejects order from another establishment', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(orderEstB);
      await expect(service.cancel('o2', manager)).rejects.toThrow(ForbiddenException);
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
      await expect(service.cancel('o4', manager)).rejects.toThrow(BadRequestException);
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

      await service.create({ address: 'вул. Хрещатик 1', external_id: 'EXT-002' }, manager);
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
      await expect(service.cancel('o1', dispatcher)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('courier cross-tenant', () => {
    it('cannot assign courier from another establishment', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(pendingOrder);
      mockPrisma.courier.findUnique.mockResolvedValue({
        id: 'c2', establishment_id: EST_B,
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

      expect(mockTelegramService.notifyEstablishmentManagers).toHaveBeenCalledWith(
        EST_A,
        expect.any(String),
        'order_created',
      );
    });

    it('assign() fires delivery_assigned to establishment managers', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(pendingOrder);
      mockPrisma.courier.findUnique.mockResolvedValue(courierA);

      await service.assign('o1', { courier_id: 'c1' }, manager);

      expect(mockTelegramService.notifyEstablishmentManagers).toHaveBeenCalledWith(
        EST_A,
        expect.any(String),
        'delivery_assigned',
      );
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
});
