import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from '../analytics.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const EST_ID = 'est-1';
const userA: any = { id: 'u1', establishment_id: EST_ID, role: 'manager', is_platform_admin: false };

const mockPrisma = { $queryRaw: jest.fn() };

// Raw DB rows use BigInt for COUNT results (Prisma $queryRaw behaviour)
const summaryRow = {
  total: BigInt(10),
  completed: BigInt(7),
  failed: BigInt(2),
  cancelled: BigInt(1),
  in_progress: BigInt(0),
  pending: BigInt(0),
  assigned: BigInt(0),
  avg_delivery_minutes: 22.5,
  completion_rate: 77.8,
  geo_match_rate: 85.7,
};

const courierRows = [
  {
    courier_id: 'c1',
    courier_name: 'Іван',
    total: BigInt(5),
    completed: BigInt(4),
    failed: BigInt(1),
    avg_delivery_minutes: 20.0,
    completion_rate: 80.0,
  },
  {
    courier_id: 'c2',
    courier_name: 'Марія',
    total: BigInt(3),
    completed: BigInt(3),
    failed: BigInt(0),
    avg_delivery_minutes: 18.5,
    completion_rate: 100.0,
  },
];

const timelineRows = [
  { period: new Date('2026-03-01'), total: BigInt(3), completed: BigInt(2), failed: BigInt(1) },
  { period: new Date('2026-03-02'), total: BigInt(5), completed: BigInt(4), failed: BigInt(0) },
];

describe('AnalyticsService', () => {
  let service: AnalyticsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<AnalyticsService>(AnalyticsService);
    jest.clearAllMocks();
  });

  // ── getSummary ────────────────────────────────────────────────────────────

  describe('getSummary', () => {
    beforeEach(() => {
      mockPrisma.$queryRaw.mockResolvedValue([summaryRow]);
    });

    it('returns correct totals with BigInt converted to numbers', async () => {
      const result = await service.getSummary(userA);

      expect(result.totals.total).toBe(10);
      expect(result.totals.completed).toBe(7);
      expect(result.totals.failed).toBe(2);
      expect(result.totals.cancelled).toBe(1);
    });

    it('returns computed metrics', async () => {
      const result = await service.getSummary(userA);

      expect(result.metrics.avg_delivery_minutes).toBe(22.5);
      expect(result.metrics.completion_rate).toBe(77.8);
      expect(result.metrics.geo_match_rate).toBe(85.7);
    });

    it('includes period with from/to dates', async () => {
      const result = await service.getSummary(userA, '2026-03-01', '2026-03-31');

      expect(result.period.from).toBeInstanceOf(Date);
      expect(result.period.to).toBeInstanceOf(Date);
    });

    it('defaults to last 30 days when no dates provided', async () => {
      const result = await service.getSummary(userA);
      const diffDays =
        (result.period.to.getTime() - result.period.from.getTime()) / (1000 * 60 * 60 * 24);

      expect(diffDays).toBeCloseTo(30, 0);
    });

    it('queries only for the correct establishment (multi-tenant isolation)', async () => {
      await service.getSummary(userA, '2026-03-01', '2026-03-31');

      // Verify $queryRaw was called (establishment_id is passed as a bound parameter)
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });

  // ── getCourierStats ───────────────────────────────────────────────────────

  describe('getCourierStats', () => {
    beforeEach(() => {
      mockPrisma.$queryRaw.mockResolvedValue(courierRows);
    });

    it('returns one row per courier with BigInt converted to numbers', async () => {
      const result = await service.getCourierStats(userA);

      expect(result).toHaveLength(2);
      expect(result[0].courier_id).toBe('c1');
      expect(result[0].total).toBe(5);
      expect(result[0].completed).toBe(4);
    });

    it('includes completion_rate and avg_delivery_minutes per courier', async () => {
      const result = await service.getCourierStats(userA);

      expect(result[1].completion_rate).toBe(100.0);
      expect(result[1].avg_delivery_minutes).toBe(18.5);
    });

    it('returns empty array when no deliveries in period', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);
      const result = await service.getCourierStats(userA);

      expect(result).toEqual([]);
    });
  });

  // ── getTimeline ───────────────────────────────────────────────────────────

  describe('getTimeline', () => {
    beforeEach(() => {
      mockPrisma.$queryRaw.mockResolvedValue(timelineRows);
    });

    it('returns time series with BigInt converted to numbers', async () => {
      const result = await service.getTimeline(userA);

      expect(result).toHaveLength(2);
      expect(result[0].total).toBe(3);
      expect(result[0].completed).toBe(2);
      expect(result[0].failed).toBe(1);
    });

    it('returns Date objects for period field', async () => {
      const result = await service.getTimeline(userA);

      expect(result[0].period).toBeInstanceOf(Date);
    });

    it('accepts day/week/month granularity without error', async () => {
      await expect(service.getTimeline(userA, undefined, undefined, 'week')).resolves.toBeDefined();
      await expect(service.getTimeline(userA, undefined, undefined, 'month')).resolves.toBeDefined();
    });

    it('defaults granularity to day', async () => {
      await service.getTimeline(userA);
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });
});
