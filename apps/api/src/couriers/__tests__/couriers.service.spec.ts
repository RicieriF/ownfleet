import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { CouriersService } from '../couriers.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';

const EST_A = 'est-a';
const EST_B = 'est-b';

const managerA: any = { id: 'u1', establishment_id: EST_A, role: 'manager' };
const dispatcherA: any = { id: 'u2', establishment_id: EST_A, role: 'dispatcher' };

const courierA = { id: 'c1', establishment_id: EST_A, name: 'Ivan', phone: null };
const courierB = { id: 'c2', establishment_id: EST_B, name: 'Petro', phone: null };

const mockPrisma = {
  courier: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  delivery: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  shift: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  $queryRaw: jest.fn().mockResolvedValue([]),
};

describe('CouriersService', () => {
  let service: CouriersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CouriersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: { sendPush: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    service = module.get<CouriersService>(CouriersService);
    jest.clearAllMocks();
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockPrisma.delivery.findMany.mockResolvedValue([]);
    mockPrisma.shift.findMany.mockResolvedValue([]);
  });

  describe('multi-tenant isolation', () => {
    it('findOne throws ForbiddenException for courier from another establishment', async () => {
      mockPrisma.courier.findUnique.mockResolvedValue(courierB);
      await expect(service.findOne('c2', managerA)).rejects.toThrow(ForbiddenException);
    });

    it('update throws ForbiddenException for courier from another establishment', async () => {
      mockPrisma.courier.findUnique.mockResolvedValue(courierB);
      await expect(
        service.update('c2', { name: 'Hacked' }, managerA),
      ).rejects.toThrow(ForbiddenException);
    });

    it('remove throws ForbiddenException for courier from another establishment', async () => {
      mockPrisma.courier.findUnique.mockResolvedValue(courierB);
      await expect(service.remove('c2', managerA)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('role-based access', () => {
    it('dispatcher cannot create courier', async () => {
      await expect(
        service.create({ name: 'Test' }, dispatcherA),
      ).rejects.toThrow(ForbiddenException);
    });

    it('dispatcher cannot update courier', async () => {
      mockPrisma.courier.findUnique.mockResolvedValue(courierA);
      await expect(
        service.update('c1', { name: 'Updated' }, dispatcherA),
      ).rejects.toThrow(ForbiddenException);
    });

    it('dispatcher cannot remove courier', async () => {
      mockPrisma.courier.findUnique.mockResolvedValue(courierA);
      await expect(service.remove('c1', dispatcherA)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('CRUD', () => {
    it('findAll queries only own establishment', async () => {
      mockPrisma.courier.findMany.mockResolvedValue([courierA]);
      await service.findAll(managerA);
      expect(mockPrisma.courier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { establishment_id: EST_A } }),
      );
    });

    it('throws NotFoundException when courier not found', async () => {
      mockPrisma.courier.findUnique.mockResolvedValue(null);
      await expect(service.findOne('nonexistent', managerA)).rejects.toThrow(NotFoundException);
    });

    it('create passes establishment_id from JWT', async () => {
      mockPrisma.courier.create.mockResolvedValue(courierA);
      await service.create({ name: 'Ivan' }, managerA);
      expect(mockPrisma.courier.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ establishment_id: EST_A }),
        }),
      );
    });
  });

  describe('device token', () => {
    it('clears device_token without throwing on DB error', async () => {
      mockPrisma.courier.update.mockRejectedValue(new Error('DB error'));
      await expect(service.clearDeviceToken('c1')).resolves.not.toThrow();
    });
  });
});
