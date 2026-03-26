import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { RetentionService } from '../retention.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ShiftsService } from '../../shifts/shifts.service.js';
import { EtaService } from '../../eta/eta.service.js';
import { TelegramService } from '../../telegram/telegram.service.js';

const mockRetentionLog = { create: jest.fn().mockResolvedValue({}) };
const mockOrder = { deleteMany: jest.fn() };
const mockEstablishment = { findMany: jest.fn() };
const mockShift = {
  findMany: jest.fn().mockResolvedValue([]),
  update: jest.fn().mockResolvedValue({}),
};

const mockPrisma = {
  establishment: mockEstablishment,
  order: mockOrder,
  shift: mockShift,
  retentionLog: mockRetentionLog,
  $executeRaw: jest.fn(),
};

const mockShiftsService = {
  autoCloseStaleShifts: jest.fn().mockResolvedValue(0),
};

const mockTelegramService = {
  notifyEstablishmentManagers: jest.fn().mockResolvedValue(undefined),
};

const mockDispatchQueue = {
  add: jest.fn().mockResolvedValue(undefined),
};

describe('RetentionService', () => {
  let service: RetentionService;

  beforeEach(async () => {
    const mockEtaService = { checkOverdueDeliveries: jest.fn().mockResolvedValue(0) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RetentionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ShiftsService, useValue: mockShiftsService },
        { provide: EtaService, useValue: mockEtaService },
        { provide: TelegramService, useValue: mockTelegramService },
        { provide: getQueueToken('dispatch'), useValue: mockDispatchQueue },
      ],
    }).compile();

    service = module.get<RetentionService>(RetentionService);
    jest.clearAllMocks();
    mockOrder.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.$executeRaw.mockResolvedValue(0);
    mockRetentionLog.create.mockResolvedValue({});
  });

  // ── cleanupEstablishment ───────────────────────────────────────────────

  describe('cleanupEstablishment', () => {
    it('deletes terminal orders older than default 90 days', async () => {
      mockOrder.deleteMany.mockResolvedValue({ count: 5 });
      mockPrisma.$executeRaw.mockResolvedValue(10);

      const result = await service.cleanupEstablishment('est-1', {});

      expect(result.deletedOrders).toBe(5);
      expect(result.deletedPings).toBe(10);

      expect(mockOrder.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            establishment_id: 'est-1',
            status: { in: ['completed', 'cancelled', 'failed'] },
          }),
        }),
      );
    });

    it('respects custom retention_days from settings', async () => {
      mockOrder.deleteMany.mockResolvedValue({ count: 3 });
      mockPrisma.$executeRaw.mockResolvedValue(0);

      await service.cleanupEstablishment('est-2', { retention_days: 30 });

      const call = mockOrder.deleteMany.mock.calls[0][0];
      const cutoff: Date = call.where.created_at.lt;
      const diffDays = (Date.now() - cutoff.getTime()) / (1000 * 60 * 60 * 24);
      // cutoff should be approximately 30 days ago (allow ±1 day for test timing)
      expect(diffDays).toBeGreaterThan(29);
      expect(diffDays).toBeLessThan(31);
    });

    it('falls back to default when retention_days is invalid', async () => {
      mockOrder.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.$executeRaw.mockResolvedValue(0);

      await service.cleanupEstablishment('est-3', { retention_days: -5 });

      const call = mockOrder.deleteMany.mock.calls[0][0];
      const cutoff: Date = call.where.created_at.lt;
      const diffDays = (Date.now() - cutoff.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(89);
    });

    it('creates retention_log only when something was deleted', async () => {
      mockOrder.deleteMany.mockResolvedValue({ count: 2 });
      mockPrisma.$executeRaw.mockResolvedValue(7);

      await service.cleanupEstablishment('est-4', {});

      expect(mockRetentionLog.create).toHaveBeenCalledTimes(1);
      expect(mockRetentionLog.create).toHaveBeenCalledWith({
        data: { establishment_id: 'est-4', deleted_orders: 2, deleted_pings: 7 },
      });
    });

    it('does NOT create retention_log when nothing was deleted', async () => {
      mockOrder.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.$executeRaw.mockResolvedValue(0);

      await service.cleanupEstablishment('est-5', {});

      expect(mockRetentionLog.create).not.toHaveBeenCalled();
    });

    it('delivery_proofs are never touched — no delete call on deliveryProof', async () => {
      mockOrder.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.$executeRaw.mockResolvedValue(0);

      await service.cleanupEstablishment('est-6', {});

      // Ensure mockPrisma has no deliveryProof.delete calls
      expect(mockPrisma).not.toHaveProperty('deliveryProof');
    });

    it('does not throw when DB error occurs — logs and returns zeros', async () => {
      mockOrder.deleteMany.mockRejectedValue(new Error('DB timeout'));

      const result = await service.cleanupEstablishment('est-7', {});

      expect(result.deletedOrders).toBe(0);
      expect(result.deletedPings).toBe(0);
    });
  });

  // ── runRetention ───────────────────────────────────────────────────────

  describe('runRetention', () => {
    it('iterates over all establishments and accumulates totals', async () => {
      // First page: 2 establishments; second page: empty (end of cursor pagination)
      mockEstablishment.findMany
        .mockResolvedValueOnce([
          { id: 'est-a', settings: {} },
          { id: 'est-b', settings: { retention_days: 30 } },
        ])
        .mockResolvedValueOnce([]);
      mockOrder.deleteMany.mockResolvedValue({ count: 3 });
      mockPrisma.$executeRaw.mockResolvedValue(5);

      await service.runRetention();

      expect(mockOrder.deleteMany).toHaveBeenCalledTimes(2);
      // 2 establishments × (3 orders + 5 pings) → both logged
      expect(mockRetentionLog.create).toHaveBeenCalledTimes(2);
    });

    it('processes remaining establishments even if one fails', async () => {
      mockEstablishment.findMany
        .mockResolvedValueOnce([
          { id: 'est-fail', settings: {} },
          { id: 'est-ok', settings: {} },
        ])
        .mockResolvedValueOnce([]);
      mockOrder.deleteMany
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce({ count: 1 });
      mockPrisma.$executeRaw.mockResolvedValue(0);

      await expect(service.runRetention()).resolves.not.toThrow();
      expect(mockOrder.deleteMany).toHaveBeenCalledTimes(2);
    });
  });
});
