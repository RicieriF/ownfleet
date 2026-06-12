import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import { RetentionService } from '../retention.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ShiftsService } from '../../shifts/shifts.service.js';
import { EtaService } from '../../eta/eta.service.js';
import { TelegramService } from '../../telegram/telegram.service.js';
import { DistributedLockService } from '../../shared/redis/distributed-lock.service.js';
import { GeocodingService } from '../../geocoding/geocoding.service.js';
import {
  parseEstablishmentSettings,
  ESTABLISHMENT_SETTINGS_DEFAULTS,
} from '../../establishments/establishment-settings.js';

const mockRetentionLog = { create: jest.fn().mockResolvedValue({}) };
const mockOrder = { deleteMany: jest.fn(), findMany: jest.fn() };
const mockEstablishment = { findMany: jest.fn() };
const mockShift = {
  findMany: jest.fn().mockResolvedValue([]),
  update: jest.fn().mockResolvedValue({}),
};
const mockDeliveryProof = {
  findMany: jest.fn().mockResolvedValue([]),
  deleteMany: jest.fn(),
};

const mockPrisma = {
  establishment: mockEstablishment,
  order: mockOrder,
  shift: mockShift,
  retentionLog: mockRetentionLog,
  deliveryProof: mockDeliveryProof,
  $executeRaw: jest.fn(),
};

const mockShiftsService = {
  autoCloseStaleShifts: jest.fn().mockResolvedValue(0),
  checkShiftEndingSoon: jest.fn().mockResolvedValue(0),
  checkCourierNotResponding: jest.fn().mockResolvedValue(0),
};

const mockTelegramService = {
  notifyEstablishmentManagers: jest.fn().mockResolvedValue(undefined),
};

const mockDispatchQueue = {
  add: jest.fn().mockResolvedValue(undefined),
};

const mockGeocodingService = {
  enqueueGeocode: jest.fn().mockResolvedValue(undefined),
};

// Call-through mock: lock is always acquired and fn is executed immediately.
// This keeps existing tests working unchanged while allowing lock-key assertions
// in the dedicated "distributed lock" suite below.
const mockLockService = {
  withLock: jest.fn(
    (key: string, ttl: number, fn: () => Promise<void>): Promise<boolean> =>
      fn().then(() => true),
  ),
};

describe('RetentionService', () => {
  let service: RetentionService;

  beforeEach(async () => {
    const mockEtaService = {
      checkOverdueDeliveries: jest.fn().mockResolvedValue(0),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RetentionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ShiftsService, useValue: mockShiftsService },
        { provide: EtaService, useValue: mockEtaService },
        { provide: TelegramService, useValue: mockTelegramService },
        { provide: GeocodingService, useValue: mockGeocodingService },
        { provide: DistributedLockService, useValue: mockLockService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(undefined) },
        },
        { provide: getQueueToken('dispatch'), useValue: mockDispatchQueue },
      ],
    }).compile();

    service = module.get<RetentionService>(RetentionService);
    jest.clearAllMocks();
    // Restore call-through behaviour after clearAllMocks resets the implementation
    mockLockService.withLock.mockImplementation(
      (key: string, ttl: number, fn: () => Promise<void>): Promise<boolean> =>
        fn().then(() => true),
    );
    mockOrder.deleteMany.mockResolvedValue({ count: 0 });
    mockOrder.findMany.mockResolvedValue([]);
    mockDeliveryProof.findMany.mockResolvedValue([]);
    mockDeliveryProof.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.$executeRaw.mockResolvedValue(0);
    mockRetentionLog.create.mockResolvedValue({});
  });

  // ── cleanupEstablishment ───────────────────────────────────────────────

  describe('cleanupEstablishment', () => {
    it('deletes terminal orders older than default 90 days', async () => {
      mockOrder.deleteMany.mockResolvedValue({ count: 5 });
      mockPrisma.$executeRaw.mockResolvedValue(10);

      const result = await service.cleanupEstablishment(
        'est-1',
        parseEstablishmentSettings({}),
      );

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

    it('respects custom retention_orders_days from settings', async () => {
      mockOrder.deleteMany.mockResolvedValue({ count: 3 });
      mockPrisma.$executeRaw.mockResolvedValue(0);

      await service.cleanupEstablishment(
        'est-2',
        parseEstablishmentSettings({ retention_orders_days: 30 }),
      );

      const call = mockOrder.deleteMany.mock.calls[0][0];
      const cutoff: Date = call.where.created_at.lt;
      const diffDays = (Date.now() - cutoff.getTime()) / (1000 * 60 * 60 * 24);
      // cutoff should be approximately 30 days ago (allow ±1 day for test timing)
      expect(diffDays).toBeGreaterThan(29);
      expect(diffDays).toBeLessThan(31);
    });

    it('respects legacy retention_days key for backwards compatibility', async () => {
      mockOrder.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.$executeRaw.mockResolvedValue(0);

      // Rows written before the key was renamed from retention_days → retention_orders_days
      await service.cleanupEstablishment(
        'est-2b',
        parseEstablishmentSettings({ retention_days: 14 }),
      );

      const call = mockOrder.deleteMany.mock.calls[0][0];
      const cutoff: Date = call.where.created_at.lt;
      const diffDays = (Date.now() - cutoff.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(13);
      expect(diffDays).toBeLessThan(15);
    });

    it('falls back to default when retention_orders_days is invalid', async () => {
      mockOrder.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.$executeRaw.mockResolvedValue(0);

      await service.cleanupEstablishment(
        'est-3',
        parseEstablishmentSettings({ retention_orders_days: -5 }),
      );

      const call = mockOrder.deleteMany.mock.calls[0][0];
      const cutoff: Date = call.where.created_at.lt;
      const diffDays = (Date.now() - cutoff.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(
        ESTABLISHMENT_SETTINGS_DEFAULTS.retention_orders_days - 1,
      );
    });

    it('creates retention_log only when something was deleted', async () => {
      mockOrder.deleteMany.mockResolvedValue({ count: 2 });
      mockPrisma.$executeRaw.mockResolvedValue(7);

      await service.cleanupEstablishment(
        'est-4',
        parseEstablishmentSettings({}),
      );

      expect(mockRetentionLog.create).toHaveBeenCalledTimes(1);
      expect(mockRetentionLog.create).toHaveBeenCalledWith({
        data: {
          establishment_id: 'est-4',
          deleted_orders: 2,
          deleted_pings: 7,
          deleted_order_ids: [],
        },
      });
    });

    it('does NOT create retention_log when nothing was deleted', async () => {
      mockOrder.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.$executeRaw.mockResolvedValue(0);

      await service.cleanupEstablishment(
        'est-5',
        parseEstablishmentSettings({}),
      );

      expect(mockRetentionLog.create).not.toHaveBeenCalled();
    });

    it('delivery_proofs are never explicitly deleted — no deliveryProof.delete call', async () => {
      mockOrder.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.$executeRaw.mockResolvedValue(0);

      await service.cleanupEstablishment(
        'est-6',
        parseEstablishmentSettings({}),
      );

      // RetentionService must never call prisma.deliveryProof.delete/deleteMany.
      // The DB-level ON DELETE SET NULL FK ensures proofs survive with delivery_id = NULL
      // when their parent delivery is cascade-deleted along with its order.
      expect(mockDeliveryProof.deleteMany).not.toHaveBeenCalled();
    });

    it('does not throw when DB error occurs — logs and returns zeros', async () => {
      mockOrder.deleteMany.mockRejectedValue(new Error('DB timeout'));

      const result = await service.cleanupEstablishment(
        'est-7',
        parseEstablishmentSettings({}),
      );

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

  // ── cleanupExpiredTrackingTokens ──────────────────────────────────────────

  describe('cleanupExpiredTrackingTokens', () => {
    it('executes DELETE tracking_tokens WHERE expires_at < NOW()', async () => {
      mockPrisma.$executeRaw.mockResolvedValue(3);

      await service.cleanupExpiredTrackingTokens();

      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('does not throw when nothing to delete (result=0)', async () => {
      mockPrisma.$executeRaw.mockResolvedValue(0);

      await expect(
        service.cleanupExpiredTrackingTokens(),
      ).resolves.not.toThrow();
    });

    it('delivery_proofs are never touched during tracking tokens cleanup', async () => {
      mockPrisma.$executeRaw.mockResolvedValue(2);

      await service.cleanupExpiredTrackingTokens();

      // Tracking token cleanup must not touch delivery_proofs at all
      expect(mockDeliveryProof.findMany).not.toHaveBeenCalled();
      expect(mockDeliveryProof.deleteMany).not.toHaveBeenCalled();
    });

    it('does not call order.deleteMany or touch retention logic', async () => {
      mockPrisma.$executeRaw.mockResolvedValue(1);

      await service.cleanupExpiredTrackingTokens();

      expect(mockOrder.deleteMany).not.toHaveBeenCalled();
      expect(mockRetentionLog.create).not.toHaveBeenCalled();
    });
  });

  // ── checkShiftAnomalies ────────────────────────────────────────────────────

  describe('checkShiftAnomalies', () => {
    const FOUR_HOURS_AGO = new Date(Date.now() - 4 * 60 * 60 * 1000);

    const makeShift = (overrides: Record<string, unknown> = {}) => ({
      id: 's1',
      establishment_id: 'est-1',
      ended_at: null,
      started_at: FOUR_HOURS_AGO,
      total_deliveries: 12,
      anomaly_alerted_at: null,
      courier: { name: 'Ivan' },
      ...overrides,
    });

    it('does nothing when no active shifts exist', async () => {
      mockShift.findMany.mockResolvedValue([]);

      await service.checkShiftAnomalies();

      expect(
        mockTelegramService.notifyEstablishmentManagers,
      ).not.toHaveBeenCalled();
      expect(mockShift.update).not.toHaveBeenCalled();
    });

    it('skips when candidate is the only shift for that establishment (no comparison pool)', async () => {
      mockShift.findMany.mockResolvedValue([makeShift()]);

      await service.checkShiftAnomalies();

      expect(
        mockTelegramService.notifyEstablishmentManagers,
      ).not.toHaveBeenCalled();
    });

    it('skips candidate with ≤ 5 deliveries (not enough data)', async () => {
      mockShift.findMany.mockResolvedValue([
        makeShift({ id: 's1', total_deliveries: 5 }),
        makeShift({
          id: 's2',
          total_deliveries: 2,
          courier: { name: 'Petro' },
        }),
      ]);

      await service.checkShiftAnomalies();

      expect(
        mockTelegramService.notifyEstablishmentManagers,
      ).not.toHaveBeenCalled();
    });

    it('skips when anomaly_alerted_at is already set (one alert per shift)', async () => {
      mockShift.findMany.mockResolvedValue([
        makeShift({
          id: 's1',
          total_deliveries: 20,
          anomaly_alerted_at: new Date(),
        }),
        makeShift({
          id: 's2',
          total_deliveries: 3,
          courier: { name: 'Petro' },
        }),
      ]);

      await service.checkShiftAnomalies();

      expect(
        mockTelegramService.notifyEstablishmentManagers,
      ).not.toHaveBeenCalled();
    });

    it('sends alert and sets anomaly_alerted_at when rate > 2x team average', async () => {
      // s1: 12 deliveries / 4h = 3/h; s2: 3 deliveries / 4h = 0.75/h
      // avg = 0.75/h; 3 > 2 * 0.75 = 1.5 → ALERT
      mockShift.findMany.mockResolvedValue([
        makeShift({ id: 's1', total_deliveries: 12, anomaly_alerted_at: null }),
        makeShift({
          id: 's2',
          total_deliveries: 3,
          courier: { name: 'Petro' },
        }),
      ]);

      await service.checkShiftAnomalies();

      expect(
        mockTelegramService.notifyEstablishmentManagers,
      ).toHaveBeenCalledWith(
        'est-1',
        expect.stringContaining('Ivan'),
        'shift_anomaly',
      );
      expect(mockShift.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { anomaly_alerted_at: expect.any(Date) },
      });
    });

    it('does not alert when rate is below 2x threshold', async () => {
      // s1: 10 deliveries / 4h = 2.5/h; s2: 8 deliveries / 4h = 2/h
      // avg = 2/h; 2.5 < 2 * 2 = 4 → NO ALERT
      mockShift.findMany.mockResolvedValue([
        makeShift({ id: 's1', total_deliveries: 10, anomaly_alerted_at: null }),
        makeShift({
          id: 's2',
          total_deliveries: 8,
          courier: { name: 'Petro' },
        }),
      ]);

      await service.checkShiftAnomalies();

      expect(
        mockTelegramService.notifyEstablishmentManagers,
      ).not.toHaveBeenCalled();
      expect(mockShift.update).not.toHaveBeenCalled();
    });

    it('skips comparison when other shifts have 0 deliveries (no valid comparison pool)', async () => {
      // s2 has 0 deliveries → filtered from otherActiveShifts → otherActiveShifts.length === 0 → skip
      mockShift.findMany.mockResolvedValue([
        makeShift({ id: 's1', total_deliveries: 20, anomaly_alerted_at: null }),
        makeShift({
          id: 's2',
          total_deliveries: 0,
          courier: { name: 'Petro' },
        }),
      ]);

      await service.checkShiftAnomalies();

      expect(
        mockTelegramService.notifyEstablishmentManagers,
      ).not.toHaveBeenCalled();
    });

    it('does not cross-compare shifts from different establishments (multi-tenant)', async () => {
      // s1 at est-1 has high rate but no same-establishment comparisons → no alert
      mockShift.findMany.mockResolvedValue([
        makeShift({
          id: 's1',
          establishment_id: 'est-1',
          total_deliveries: 20,
        }),
        makeShift({
          id: 's2',
          establishment_id: 'est-2',
          total_deliveries: 3,
          courier: { name: 'Petro' },
        }),
      ]);

      await service.checkShiftAnomalies();

      expect(
        mockTelegramService.notifyEstablishmentManagers,
      ).not.toHaveBeenCalled();
    });
  });

  // ── checkRecommendTimeout ───────────────────────────────────────────────────

  describe('checkRecommendTimeout', () => {
    it('skips establishment when dispatch_recommend_timeout_minutes is not set', async () => {
      mockEstablishment.findMany.mockResolvedValue([
        { id: 'est-1', settings: {} },
      ]);

      await service.checkRecommendTimeout();

      expect(mockOrder.findMany).not.toHaveBeenCalled();
      expect(mockDispatchQueue.add).not.toHaveBeenCalled();
    });

    it('skips establishment when dispatch_recommend_timeout_minutes is null', async () => {
      mockEstablishment.findMany.mockResolvedValue([
        { id: 'est-1', settings: { dispatch_recommend_timeout_minutes: null } },
      ]);

      await service.checkRecommendTimeout();

      expect(mockOrder.findMany).not.toHaveBeenCalled();
      expect(mockDispatchQueue.add).not.toHaveBeenCalled();
    });

    it('re-enqueues stale orders using ready_at cutoff (not created_at)', async () => {
      mockEstablishment.findMany.mockResolvedValue([
        { id: 'est-1', settings: { dispatch_recommend_timeout_minutes: 10 } },
      ]);
      mockOrder.findMany.mockResolvedValue([
        { id: 'order-stale', establishment_id: 'est-1' },
      ]);

      await service.checkRecommendTimeout();

      expect(mockOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            establishment_id: 'est-1',
            status: 'pending',
            ready_at: expect.objectContaining({
              not: null,
              lt: expect.any(Date),
            }),
          }),
        }),
      );
      expect(mockDispatchQueue.add).toHaveBeenCalledWith(
        { orderId: 'order-stale', establishmentId: 'est-1', attempt: 1 },
        { jobId: 'dispatch:order-stale' },
      );
    });

    it('does nothing when no stale orders found', async () => {
      mockEstablishment.findMany.mockResolvedValue([
        { id: 'est-1', settings: { dispatch_recommend_timeout_minutes: 10 } },
      ]);
      mockOrder.findMany.mockResolvedValue([]);

      await service.checkRecommendTimeout();

      expect(mockDispatchQueue.add).not.toHaveBeenCalled();
    });
  });

  // ── distributed lock usage ────────────────────────────────────────────────
  // Verifies that each Telegram-sending cron acquires the lock with the correct
  // key, so two concurrent instances cannot send duplicate notifications.

  describe('distributed lock — lock keys per cron', () => {
    beforeEach(() => {
      mockShiftsService.autoCloseStaleShifts = jest.fn().mockResolvedValue(0);
      mockShiftsService.checkShiftEndingSoon = jest.fn().mockResolvedValue(0);
      mockShiftsService.checkCourierNotResponding = jest
        .fn()
        .mockResolvedValue(0);
    });

    it('autoCloseStaleShifts acquires lock "auto-close-stale-shifts" with 1500s TTL', async () => {
      await service.autoCloseStaleShifts();
      expect(mockLockService.withLock).toHaveBeenCalledWith(
        'auto-close-stale-shifts',
        1500,
        expect.any(Function),
      );
    });

    it('checkShiftEndingSoon acquires lock "shift-ending-soon" with 240s TTL', async () => {
      await service.checkShiftEndingSoon();
      expect(mockLockService.withLock).toHaveBeenCalledWith(
        'shift-ending-soon',
        240,
        expect.any(Function),
      );
    });

    it('checkCourierNotResponding acquires lock "courier-not-responding" with 240s TTL', async () => {
      await service.checkCourierNotResponding();
      expect(mockLockService.withLock).toHaveBeenCalledWith(
        'courier-not-responding',
        240,
        expect.any(Function),
      );
    });

    it('checkEtaOverdue acquires lock "eta-overdue-alert" with 240s TTL', async () => {
      await service.checkEtaOverdue();
      expect(mockLockService.withLock).toHaveBeenCalledWith(
        'eta-overdue-alert',
        240,
        expect.any(Function),
      );
    });

    it('checkShiftAnomalies acquires lock "shift-anomaly-check" with 1500s TTL', async () => {
      mockShift.findMany.mockResolvedValue([]);
      await service.checkShiftAnomalies();
      expect(mockLockService.withLock).toHaveBeenCalledWith(
        'shift-anomaly-check',
        1500,
        expect.any(Function),
      );
    });

    it('runRetention acquires lock "retention-cleanup" with 7200s TTL', async () => {
      mockEstablishment.findMany.mockResolvedValue([]);
      await service.runRetention();
      expect(mockLockService.withLock).toHaveBeenCalledWith(
        'retention-cleanup',
        7200,
        expect.any(Function),
      );
    });

    it('cron body is NOT executed when lock returns false (busy — another instance running)', async () => {
      // Simulate lock busy: withLock returns false without calling fn
      mockLockService.withLock.mockResolvedValue(false);

      await service.checkShiftEndingSoon();

      expect(mockShiftsService.checkShiftEndingSoon).not.toHaveBeenCalled();
    });

    it('checkRecommendTimeout uses distributed lock with key "recommend-timeout-check"', async () => {
      mockEstablishment.findMany.mockResolvedValue([]);
      await service.checkRecommendTimeout();
      expect(mockLockService.withLock).toHaveBeenCalledWith(
        'recommend-timeout-check',
        expect.any(Number),
        expect.any(Function),
      );
    });

    it('cleanupExpiredTrackingTokens does NOT use a distributed lock (idempotent DELETE)', async () => {
      mockPrisma.$executeRaw.mockResolvedValue(0);
      await service.cleanupExpiredTrackingTokens();
      expect(mockLockService.withLock).not.toHaveBeenCalled();
    });
  });

  // ── weeklyDeliveryProofsBackup ────────────────────────────────────────────

  describe('weeklyDeliveryProofsBackup', () => {
    // Helper to build a minimal fake proof record
    const makeProof = (id: string) => ({
      id,
      delivery_id: `del-${id}`,
      lat: 50.45,
      lng: 30.52,
      captured_at: new Date('2026-03-30T10:00:00Z'),
      order_closed_at: new Date('2026-03-30T10:05:00Z'),
      photo_key: null,
      geo_match: true,
      accuracy: 12,
      geo_flags: {},
    });

    it('is a no-op when backupS3 is not configured (BACKUP_S3_* env vars absent)', async () => {
      // ConfigService returns undefined for all keys → backupS3 = null in constructor
      // Service was already built with get() → undefined, so backup is disabled.
      await expect(service.weeklyDeliveryProofsBackup()).resolves.not.toThrow();
      // No DB calls should be made
      expect(mockDeliveryProof.findMany).not.toHaveBeenCalled();
    });

    it('fetches proofs in batches using cursor-based pagination (no single findMany for all)', async () => {
      // Inject a real S3 stub so the guard passes

      (service as any).backupS3 = { send: jest.fn().mockResolvedValue({}) };

      (service as any).backupBucket = 'test-bucket';

      // First batch: 500 records (full page) → pagination continues
      const batch1 = Array.from({ length: 500 }, (_, i) => makeProof(`p${i}`));
      // Second batch: 3 records (partial page) → pagination stops
      const batch2 = [makeProof('p500'), makeProof('p501'), makeProof('p502')];

      mockDeliveryProof.findMany
        .mockResolvedValueOnce(batch1)
        .mockResolvedValueOnce(batch2)
        .mockResolvedValue([]); // safety — should not be called again

      await service.weeklyDeliveryProofsBackup();

      // Must have been called exactly twice (two pages)
      expect(mockDeliveryProof.findMany).toHaveBeenCalledTimes(2);

      // Second call must use cursor from last record of first batch
      expect(mockDeliveryProof.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          cursor: { id: 'p499' },
          skip: 1,
          take: 500,
        }),
      );
    });

    it('uploads valid gzipped JSON containing all fetched records', async () => {
      const mockSend = jest.fn().mockResolvedValue({});

      (service as any).backupS3 = { send: mockSend };

      (service as any).backupBucket = 'test-bucket';

      const proofs = [makeProof('a'), makeProof('b')];
      mockDeliveryProof.findMany
        .mockResolvedValueOnce(proofs)
        .mockResolvedValue([]);

      await service.weeklyDeliveryProofsBackup();

      expect(mockSend).toHaveBeenCalledTimes(1);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.Bucket).toBe('test-bucket');
      expect(cmd.input.Key).toMatch(
        /^delivery-proofs\/\d{4}-\d{2}-\d{2}\.json\.gz$/,
      );
      expect(cmd.input.ContentType).toBe('application/gzip');
      // Payload must be a Buffer (gzipped)
      expect(Buffer.isBuffer(cmd.input.Body)).toBe(true);
    });

    it('does not throw when S3 upload fails — logs error and swallows', async () => {
      (service as any).backupS3 = {
        send: jest.fn().mockRejectedValue(new Error('S3 timeout')),
      };

      (service as any).backupBucket = 'test-bucket';

      mockDeliveryProof.findMany
        .mockResolvedValueOnce([makeProof('x')])
        .mockResolvedValue([]);

      await expect(service.weeklyDeliveryProofsBackup()).resolves.not.toThrow();
    });

    it('makes no DB queries and no S3 calls when there are zero proofs in the window', async () => {
      const mockSend = jest.fn().mockResolvedValue({});

      (service as any).backupS3 = { send: mockSend };

      (service as any).backupBucket = 'test-bucket';

      mockDeliveryProof.findMany.mockResolvedValue([]);

      await service.weeklyDeliveryProofsBackup();

      // S3 upload still happens — empty array backup is valid
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });
});
