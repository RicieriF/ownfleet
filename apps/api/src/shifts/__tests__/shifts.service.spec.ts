import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ShiftsService } from '../shifts.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TrackingGateway } from '../../tracking/tracking.gateway';
import { JwtPayload } from '../../auth/auth.types';

const mockGateway = {
  broadcastToEstablishment: jest.fn(),
};

const mockPrisma = {
  shift: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    findMany: jest.fn(),
  },
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
      const created = { id: 'shift-new', courier_id: 'courier-1', planned_end_at: new Date(planned) };
      mockPrisma.shift.create.mockResolvedValue(created);

      const result = await service.startShift(courierUser, { planned_end_at: planned });

      expect(mockPrisma.shift.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          courier_id: 'courier-1',
          establishment_id: 'est-1',
          planned_end_at: new Date(planned),
        }),
      });
      expect(result).toEqual(created);
    });

    it('creates shift without planned_end_at when not provided', async () => {
      mockPrisma.shift.findFirst.mockResolvedValue(null);
      mockPrisma.shift.create.mockResolvedValue({ id: 'shift-new' });

      await service.startShift(courierUser, {});

      expect(mockPrisma.shift.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ planned_end_at: null }),
      });
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
      mockPrisma.shift.findFirst.mockResolvedValue({ id: 'shift-1', ended_at: null });
      mockPrisma.shift.update.mockResolvedValue({ id: 'shift-1', ended_by: 'courier' });

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
      mockPrisma.shift.findFirst.mockResolvedValue({ id: 'shift-1', ended_at: new Date() });
      await expect(service.endShiftByManager('shift-1', managerUser)).rejects.toThrow(
        ConflictException,
      );
    });

    it('ends shift with ended_by=manager', async () => {
      mockPrisma.shift.findFirst.mockResolvedValue({ id: 'shift-1', ended_at: null });
      mockPrisma.shift.update.mockResolvedValue({ id: 'shift-1', ended_by: 'manager' });

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

      const result = await service.autoCloseStaleShifts();

      expect(result).toBe(2);
      expect(mockPrisma.shift.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['s1', 's2'] } },
        data: expect.objectContaining({ ended_by: 'auto' }),
      });
    });
  });
});
