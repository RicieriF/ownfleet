import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ShiftsService } from '../shifts.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TrackingGateway } from '../../tracking/tracking.gateway';
import { TelegramService } from '../../telegram/telegram.service.js';
import { JwtPayload } from '../../auth/auth.types';

const mockGateway = {
  broadcastToEstablishment: jest.fn(),
};

const mockTelegramService = {
  notifyEstablishmentManagers: jest.fn().mockResolvedValue(undefined),
  notifyCourier: jest.fn().mockResolvedValue(undefined),
};

const mockPrisma = {
  shift: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    findMany: jest.fn(),
  },
  courier: { findMany: jest.fn().mockResolvedValue([]) },
  $queryRaw: jest.fn(),
};

const courierUser: JwtPayload = {
  sub: 'user-1',
  establishment_id: 'est-1',
  role: 'dispatcher' as any,
  is_platform_admin: false,
  courier_id: 'courier-1',
};

const managerUser: JwtPayload = {
  sub: 'manager-1',
  establishment_id: 'est-1',
  role: 'manager' as any,
  is_platform_admin: false,
};

describe('ShiftsService', () => {
  let service: ShiftsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShiftsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TrackingGateway, useValue: mockGateway },
        { provide: TelegramService, useValue: mockTelegramService },
      ],
    }).compile();

    service = module.get<ShiftsService>(ShiftsService);
    jest.clearAllMocks();
  });

  // ── startShift ─────────────────────────────────────────────────────────────

  describe('startShift', () => {
    it('throws UnprocessableEntityException when user has no courier_id', async () => {
      await expect(service.startShift(managerUser, {})).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('throws ConflictException when active shift already exists', async () => {
      mockPrisma.shift.findFirst.mockResolvedValue({ id: 'shift-1', ended_at: null });
      await expect(service.startShift(courierUser, {})).rejects.toThrow(ConflictException);
    });

    it('creates shift with planned_end_at when provided', async () => {
      mockPrisma.shift.findFirst.mockResolvedValue(null);
      const planned = '2026-03-23T18:00:00.000Z';
      const created = { id: 'shift-new', courier_id: 'courier-1', planned_end_at: new Date(planned), courier: { name: 'Ivan' } };
      mockPrisma.shift.create.mockResolvedValue(created);

      const result = await service.startShift(courierUser, { planned_end_at: planned });

      expect(mockPrisma.shift.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            courier_id: 'courier-1',
            establishment_id: 'est-1',
            planned_end_at: new Date(planned),
          }),
        }),
      );
      expect(result).toEqual(created);
    });

    it('creates shift without planned_end_at when not provided', async () => {
      mockPrisma.shift.findFirst.mockResolvedValue(null);
      mockPrisma.shift.create.mockResolvedValue({ id: 'shift-new', courier: { name: 'Ivan' } });

      await service.startShift(courierUser, {});

      expect(mockPrisma.shift.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ planned_end_at: null }),
        }),
      );
    });
  });

  // ── endShift ───────────────────────────────────────────────────────────────

  describe('endShift', () => {
    it('throws UnprocessableEntityException when user has no courier_id', async () => {
      await expect(service.endShift(managerUser)).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws NotFoundException when no active shift', async () => {
      mockPrisma.shift.findFirst.mockResolvedValue(null);
      await expect(service.endShift(courierUser)).rejects.toThrow(NotFoundException);
    });

    it('ends active shift with ended_by=courier', async () => {
      mockPrisma.shift.findFirst.mockResolvedValue({ id: 'shift-1', ended_at: null, courier: { name: 'Ivan' } });
      mockPrisma.shift.update.mockResolvedValue({ id: 'shift-1', ended_by: 'courier', establishment_id: 'est-1' });

      await service.endShift(courierUser);

      expect(mockPrisma.shift.update).toHaveBeenCalledWith({
        where: { id: 'shift-1' },
        data: expect.objectContaining({ ended_by: 'courier' }),
      });
    });
  });

  // ── endShiftByManager ──────────────────────────────────────────────────────

  describe('endShiftByManager', () => {
    it('throws NotFoundException for unknown shift', async () => {
      mockPrisma.shift.findFirst.mockResolvedValue(null);
      await expect(service.endShiftByManager('shift-x', managerUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException for already-ended shift', async () => {
      mockPrisma.shift.findFirst.mockResolvedValue({ id: 'shift-1', ended_at: new Date(), courier: { name: 'Ivan' } });
      await expect(service.endShiftByManager('shift-1', managerUser)).rejects.toThrow(
        ConflictException,
      );
    });

    it('ends shift with ended_by=manager', async () => {
      mockPrisma.shift.findFirst.mockResolvedValue({ id: 'shift-1', ended_at: null, courier: { name: 'Ivan' } });
      mockPrisma.shift.update.mockResolvedValue({ id: 'shift-1', ended_by: 'manager', establishment_id: 'est-1' });

      await service.endShiftByManager('shift-1', managerUser);

      expect(mockPrisma.shift.update).toHaveBeenCalledWith({
        where: { id: 'shift-1' },
        data: expect.objectContaining({ ended_by: 'manager' }),
      });
    });
  });

  // ── hasActiveShift ─────────────────────────────────────────────────────────

  describe('hasActiveShift', () => {
    it('returns true when active shift exists', async () => {
      mockPrisma.shift.findFirst.mockResolvedValue({ id: 'shift-1' });
      expect(await service.hasActiveShift('courier-1')).toBe(true);
    });

    it('returns false when no active shift', async () => {
      mockPrisma.shift.findFirst.mockResolvedValue(null);
      expect(await service.hasActiveShift('courier-1')).toBe(false);
    });
  });

  // ── autoCloseStaleShifts ───────────────────────────────────────────────────

  describe('autoCloseStaleShifts', () => {
    it('returns 0 when no stale shifts', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);
      expect(await service.autoCloseStaleShifts()).toBe(0);
      expect(mockPrisma.shift.updateMany).not.toHaveBeenCalled();
    });

    it('closes stale shifts and returns count', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        { id: 's1', courier_id: 'c1', establishment_id: 'est-1' },
        { id: 's2', courier_id: 'c2', establishment_id: 'est-1' },
      ]);
      mockPrisma.shift.updateMany.mockResolvedValue({ count: 2 });
      mockPrisma.courier.findMany.mockResolvedValue([
        { id: 'c1', name: 'Ivan' },
        { id: 'c2', name: 'Petro' },
      ]);

      const result = await service.autoCloseStaleShifts();

      expect(result).toBe(2);
      expect(mockPrisma.shift.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['s1', 's2'] } },
        data: expect.objectContaining({ ended_by: 'auto' }),
      });
    });
  });

  // ── Telegram notifications ─────────────────────────────────────────────────

  describe('Telegram notifications', () => {
    it('startShift() fires courier_shift_started to establishment managers', async () => {
      mockPrisma.shift.findFirst.mockResolvedValue(null);
      mockPrisma.shift.create.mockResolvedValue({
        id: 'shift-new',
        courier_id: 'courier-1',
        establishment_id: 'est-1',
        courier: { name: 'Ivan' },
      });

      await service.startShift(courierUser, {});

      expect(mockTelegramService.notifyEstablishmentManagers).toHaveBeenCalledWith(
        'est-1',
        expect.any(String),
        'courier_shift_started',
      );
    });

    it('endShift() fires courier_shift_ended to establishment managers', async () => {
      mockPrisma.shift.findFirst.mockResolvedValue({ id: 'shift-1', ended_at: null, courier: { name: 'Ivan' } });
      mockPrisma.shift.update.mockResolvedValue({ id: 'shift-1', ended_by: 'courier', establishment_id: 'est-1' });

      await service.endShift(courierUser);

      expect(mockTelegramService.notifyEstablishmentManagers).toHaveBeenCalledWith(
        'est-1',
        expect.any(String),
        'courier_shift_ended',
      );
    });

    it('endShiftByManager() fires courier_shift_ended to establishment managers', async () => {
      mockPrisma.shift.findFirst.mockResolvedValue({ id: 'shift-1', ended_at: null, courier: { name: 'Ivan' } });
      mockPrisma.shift.update.mockResolvedValue({ id: 'shift-1', ended_by: 'manager', establishment_id: 'est-1' });

      await service.endShiftByManager('shift-1', managerUser);

      expect(mockTelegramService.notifyEstablishmentManagers).toHaveBeenCalledWith(
        'est-1',
        expect.any(String),
        'courier_shift_ended',
      );
    });

    it('autoCloseStaleShifts() fires courier_shift_auto_closed once per stale shift', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        { id: 's1', courier_id: 'c1', establishment_id: 'est-1' },
        { id: 's2', courier_id: 'c2', establishment_id: 'est-1' },
      ]);
      mockPrisma.shift.updateMany.mockResolvedValue({ count: 2 });
      mockPrisma.courier.findMany.mockResolvedValue([
        { id: 'c1', name: 'Ivan' },
        { id: 'c2', name: 'Petro' },
      ]);

      await service.autoCloseStaleShifts();

      expect(mockTelegramService.notifyEstablishmentManagers).toHaveBeenCalledTimes(2);
      expect(mockTelegramService.notifyEstablishmentManagers).toHaveBeenCalledWith(
        'est-1',
        expect.any(String),
        'courier_shift_auto_closed',
      );
    });
  });
});
