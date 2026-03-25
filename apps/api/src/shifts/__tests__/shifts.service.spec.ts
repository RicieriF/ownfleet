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
  setNxWithTtl: jest.fn().mockResolvedValue(true),
  sendMessage: jest.fn().mockResolvedValue(undefined),
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
  delivery: { findMany: jest.fn() },
  establishment: { findMany: jest.fn() },
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
    mockTelegramService.setNxWithTtl.mockResolvedValue(true);
    mockTelegramService.sendMessage.mockResolvedValue(undefined);
    mockPrisma.delivery.findMany.mockResolvedValue([]);
    mockPrisma.establishment.findMany.mockResolvedValue([]);
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

  // ── checkShiftEndingSoon ───────────────────────────────────────────────────

  describe('checkShiftEndingSoon', () => {
    const chatId = 'tg-99';

    function makeShift(overrides: {
      planned_end_at: Date | null;
      telegram_chat_id?: string | null;
      prefs?: Record<string, unknown>;
    }) {
      return {
        id: 'shift-s1',
        planned_end_at: overrides.planned_end_at,
        courier: {
          telegram_chat_id: 'telegram_chat_id' in overrides ? overrides.telegram_chat_id : chatId,
          telegram_prefs: overrides.prefs ?? { shift_ending_soon: true },
        },
      };
    }

    it('returns 0 when no active shifts with planned_end_at', async () => {
      mockPrisma.shift.findMany.mockResolvedValue([]);
      expect(await service.checkShiftEndingSoon()).toBe(0);
      expect(mockTelegramService.sendMessage).not.toHaveBeenCalled();
    });

    it('returns 0 when courier has no telegram_chat_id', async () => {
      mockPrisma.shift.findMany.mockResolvedValue([
        makeShift({ planned_end_at: new Date(Date.now() + 20 * 60 * 1000), telegram_chat_id: null }),
      ]);
      // Prisma filter already excludes these, but the method should not crash if chatId is null
      expect(await service.checkShiftEndingSoon()).toBe(0);
      expect(mockTelegramService.sendMessage).not.toHaveBeenCalled();
    });

    it('returns 0 when shift_ending_soon pref is false', async () => {
      mockPrisma.shift.findMany.mockResolvedValue([
        makeShift({ planned_end_at: new Date(Date.now() + 20 * 60 * 1000), prefs: { shift_ending_soon: false } }),
      ]);
      expect(await service.checkShiftEndingSoon()).toBe(0);
      expect(mockTelegramService.sendMessage).not.toHaveBeenCalled();
    });

    it('returns 0 when shift_ending_soon pref is absent', async () => {
      mockPrisma.shift.findMany.mockResolvedValue([
        makeShift({ planned_end_at: new Date(Date.now() + 20 * 60 * 1000), prefs: {} }),
      ]);
      expect(await service.checkShiftEndingSoon()).toBe(0);
      expect(mockTelegramService.sendMessage).not.toHaveBeenCalled();
    });

    it('returns 0 when not yet within threshold (60 min away, threshold 30 min)', async () => {
      mockPrisma.shift.findMany.mockResolvedValue([
        makeShift({
          planned_end_at: new Date(Date.now() + 60 * 60 * 1000),
          prefs: { shift_ending_soon: true },
        }),
      ]);
      expect(await service.checkShiftEndingSoon()).toBe(0);
      expect(mockTelegramService.sendMessage).not.toHaveBeenCalled();
    });

    it('returns 0 when planned_end_at is already in the past', async () => {
      mockPrisma.shift.findMany.mockResolvedValue([
        makeShift({
          planned_end_at: new Date(Date.now() - 5 * 60 * 1000),
          prefs: { shift_ending_soon: true },
        }),
      ]);
      expect(await service.checkShiftEndingSoon()).toBe(0);
      expect(mockTelegramService.sendMessage).not.toHaveBeenCalled();
    });

    it('sends notification and returns 1 when within default 30-min threshold', async () => {
      mockPrisma.shift.findMany.mockResolvedValue([
        makeShift({
          planned_end_at: new Date(Date.now() + 20 * 60 * 1000),
          prefs: { shift_ending_soon: true },
        }),
      ]);

      const result = await service.checkShiftEndingSoon();

      expect(result).toBe(1);
      expect(mockTelegramService.setNxWithTtl).toHaveBeenCalledWith(
        'telegram:shift_ending_soon:shift-s1',
        expect.any(Number),
      );
      expect(mockTelegramService.sendMessage).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('⏰'),
      );
    });

    it('returns 0 (no duplicate) when Redis dedup key already exists', async () => {
      mockTelegramService.setNxWithTtl.mockResolvedValueOnce(false);
      mockPrisma.shift.findMany.mockResolvedValue([
        makeShift({
          planned_end_at: new Date(Date.now() + 20 * 60 * 1000),
          prefs: { shift_ending_soon: true },
        }),
      ]);

      const result = await service.checkShiftEndingSoon();

      expect(result).toBe(0);
      expect(mockTelegramService.sendMessage).not.toHaveBeenCalled();
    });

    it('respects custom shift_ending_soon_min: sends at 8 min when threshold is 10 min', async () => {
      mockPrisma.shift.findMany.mockResolvedValue([
        makeShift({
          planned_end_at: new Date(Date.now() + 8 * 60 * 1000),
          prefs: { shift_ending_soon: true, shift_ending_soon_min: 10 },
        }),
      ]);

      const result = await service.checkShiftEndingSoon();

      expect(result).toBe(1);
      expect(mockTelegramService.sendMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('⏰'));
    });

    it('does NOT send when 15 min away but threshold is 10 min', async () => {
      mockPrisma.shift.findMany.mockResolvedValue([
        makeShift({
          planned_end_at: new Date(Date.now() + 15 * 60 * 1000),
          prefs: { shift_ending_soon: true, shift_ending_soon_min: 10 },
        }),
      ]);

      expect(await service.checkShiftEndingSoon()).toBe(0);
      expect(mockTelegramService.sendMessage).not.toHaveBeenCalled();
    });
  });

  // ── checkCourierNotResponding ──────────────────────────────────────────────

  describe('checkCourierNotResponding', () => {
    function makeDelivery(overrides: {
      id?: string;
      courier_id?: string;
      courier_name?: string;
      telegram_chat_id?: string | null;
      est_id?: string;
      external_id?: string | null;
    }) {
      return {
        id: overrides.id ?? 'del-1',
        courier_id: overrides.courier_id ?? 'c-1',
        courier: {
          name: overrides.courier_name ?? 'Ivan',
          telegram_chat_id: 'telegram_chat_id' in overrides ? overrides.telegram_chat_id : 'tg-1',
        },
        order: {
          establishment_id: overrides.est_id ?? 'est-1',
          external_id: overrides.external_id ?? 'EXT-001',
          id: 'order-uuid-1',
        },
      };
    }

    function makeEst(id = 'est-1', settings: Record<string, unknown> = {}) {
      return { id, settings };
    }

    it('returns 0 when no in_progress deliveries', async () => {
      mockPrisma.delivery.findMany.mockResolvedValue([]);
      expect(await service.checkCourierNotResponding()).toBe(0);
      expect(mockTelegramService.notifyEstablishmentManagers).not.toHaveBeenCalled();
    });

    it('returns 0 when courier has no telegram_chat_id', async () => {
      mockPrisma.delivery.findMany.mockResolvedValue([makeDelivery({ telegram_chat_id: null })]);
      mockPrisma.establishment.findMany.mockResolvedValue([makeEst()]);
      mockPrisma.$queryRaw.mockResolvedValue([{ courier_id: 'c-1', last_ping: new Date(Date.now() - 5 * 60 * 1000) }]);

      expect(await service.checkCourierNotResponding()).toBe(0);
      expect(mockTelegramService.notifyEstablishmentManagers).not.toHaveBeenCalled();
    });

    it('returns 0 when last ping is within default threshold (5 min ago, threshold 15 min)', async () => {
      mockPrisma.delivery.findMany.mockResolvedValue([makeDelivery({})]);
      mockPrisma.establishment.findMany.mockResolvedValue([makeEst()]);
      mockPrisma.$queryRaw.mockResolvedValue([{ courier_id: 'c-1', last_ping: new Date(Date.now() - 5 * 60 * 1000) }]);

      expect(await service.checkCourierNotResponding()).toBe(0);
      expect(mockTelegramService.notifyEstablishmentManagers).not.toHaveBeenCalled();
    });

    it('sends notification and returns 1 when last ping exceeds default threshold (20 min ago)', async () => {
      mockPrisma.delivery.findMany.mockResolvedValue([makeDelivery({})]);
      mockPrisma.establishment.findMany.mockResolvedValue([makeEst()]);
      mockPrisma.$queryRaw.mockResolvedValue([{ courier_id: 'c-1', last_ping: new Date(Date.now() - 20 * 60 * 1000) }]);

      const result = await service.checkCourierNotResponding();

      expect(result).toBe(1);
      expect(mockTelegramService.notifyEstablishmentManagers).toHaveBeenCalledWith(
        'est-1',
        expect.stringContaining('⚠️'),
        'courier_not_responding',
      );
    });

    it('returns 0 (no duplicate) when Redis dedup key already exists', async () => {
      mockTelegramService.setNxWithTtl.mockResolvedValueOnce(false);
      mockPrisma.delivery.findMany.mockResolvedValue([makeDelivery({})]);
      mockPrisma.establishment.findMany.mockResolvedValue([makeEst()]);
      mockPrisma.$queryRaw.mockResolvedValue([{ courier_id: 'c-1', last_ping: new Date(Date.now() - 20 * 60 * 1000) }]);

      expect(await service.checkCourierNotResponding()).toBe(0);
      expect(mockTelegramService.notifyEstablishmentManagers).not.toHaveBeenCalled();
    });

    it('sends notification when courier has never pinged (no entry in location_pings)', async () => {
      mockPrisma.delivery.findMany.mockResolvedValue([makeDelivery({})]);
      mockPrisma.establishment.findMany.mockResolvedValue([makeEst()]);
      // No rows = courier absent from location_pings entirely → pingMap.get returns undefined → lastPing = null
      mockPrisma.$queryRaw.mockResolvedValue([]);

      const result = await service.checkCourierNotResponding();

      expect(result).toBe(1);
      expect(mockTelegramService.notifyEstablishmentManagers).toHaveBeenCalledWith(
        'est-1',
        expect.stringContaining('⚠️'),
        'courier_not_responding',
      );
    });

    it('respects custom courier_not_responding_min: 20 min ago does NOT send when threshold is 30', async () => {
      mockPrisma.delivery.findMany.mockResolvedValue([makeDelivery({})]);
      mockPrisma.establishment.findMany.mockResolvedValue([makeEst('est-1', { courier_not_responding_min: 30 })]);
      mockPrisma.$queryRaw.mockResolvedValue([{ courier_id: 'c-1', last_ping: new Date(Date.now() - 20 * 60 * 1000) }]);

      expect(await service.checkCourierNotResponding()).toBe(0);
      expect(mockTelegramService.notifyEstablishmentManagers).not.toHaveBeenCalled();
    });

    it('respects custom courier_not_responding_min: 31 min ago DOES send when threshold is 30', async () => {
      mockPrisma.delivery.findMany.mockResolvedValue([makeDelivery({})]);
      mockPrisma.establishment.findMany.mockResolvedValue([makeEst('est-1', { courier_not_responding_min: 30 })]);
      mockPrisma.$queryRaw.mockResolvedValue([{ courier_id: 'c-1', last_ping: new Date(Date.now() - 31 * 60 * 1000) }]);

      const result = await service.checkCourierNotResponding();

      expect(result).toBe(1);
      expect(mockTelegramService.notifyEstablishmentManagers).toHaveBeenCalledWith(
        'est-1',
        expect.stringContaining('⚠️'),
        'courier_not_responding',
      );
    });
  });
});
