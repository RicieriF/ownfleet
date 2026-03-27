import { Test, TestingModule } from '@nestjs/testing';
import { EtaService } from '../eta.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TelegramService } from '../../telegram/telegram.service.js';

// ── fetch mock ──────────────────────────────────────────────────────────────
const mockFetch = jest.fn();
global.fetch = mockFetch;

const makeOsrmOk = (duration: number) => ({
  ok: true,
  json: async () => ({ code: 'Ok', routes: [{ duration }] }),
});

const makeOsrmBadCode = (code: string) => ({
  ok: true,
  json: async () => ({ code, routes: [] }),
});

const makeHttpError = (status: number) => ({ ok: false, status });

// ── Prisma mocks ────────────────────────────────────────────────────────────
const mockDelivery = {
  findMany: jest.fn(),
  findFirst: jest.fn(),
  update: jest.fn().mockResolvedValue({}),
  updateMany: jest.fn().mockResolvedValue({ count: 0 }),
};

const mockPrisma = { delivery: mockDelivery };

const mockTelegramService = {
  notifyEstablishmentManagers: jest.fn().mockResolvedValue(undefined),
};

// ── Constants mirrored from eta.service.ts ──────────────────────────────────
const MOTO_ELECTRIC_FACTOR = 50 / 35;
const BUFFER = 3 * 60; // 180s

// ── ETA params fixture ──────────────────────────────────────────────────────
const BASE_PARAMS = {
  establishmentLat: 50.45,
  establishmentLng: 30.52,
  orderLat: 50.46,
  orderLng: 30.53,
  transportMode: 'car' as const,
  timezone: 'UTC',
};

describe('EtaService', () => {
  let service: EtaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EtaService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TelegramService, useValue: mockTelegramService },
      ],
    }).compile();

    service = module.get<EtaService>(EtaService);
    jest.clearAllMocks();
    mockDelivery.findMany.mockResolvedValue([]);
    mockDelivery.findFirst.mockResolvedValue(null);
    mockDelivery.update.mockResolvedValue({});
    mockDelivery.updateMany.mockResolvedValue({ count: 0 });
  });

  // ── calculateEta ──────────────────────────────────────────────────────────

  describe('calculateEta', () => {
    // Pin time to 14:00 UTC — outside peak hours (7–9, 17–19) so coefficient = 1.0
    beforeAll(() => jest.useFakeTimers({ now: new Date('2024-01-15T14:00:00.000Z') }));
    afterAll(() => jest.useRealTimers());

    it('car mode → returns OSRM duration + 3-minute buffer', async () => {
      mockFetch.mockResolvedValue(makeOsrmOk(300));

      const result = await service.calculateEta(BASE_PARAMS);

      // 300s OSRM + 180s buffer = 480s (non-peak UTC)
      expect(result).toBe(480);
    });

    it('moto_electric → applies 50/35 speed correction before buffer', async () => {
      mockFetch.mockResolvedValue(makeOsrmOk(300));

      const result = await service.calculateEta({ ...BASE_PARAMS, transportMode: 'moto_electric' });

      expect(result).toBe(Math.round(300 * MOTO_ELECTRIC_FACTOR + BUFFER));
    });

    it('moto_gas → no speed correction (same as car)', async () => {
      mockFetch.mockResolvedValue(makeOsrmOk(300));

      const result = await service.calculateEta({ ...BASE_PARAMS, transportMode: 'moto_gas' });

      expect(result).toBe(480);
    });

    it('bicycle and walking → no moto correction applied', async () => {
      mockFetch.mockResolvedValue(makeOsrmOk(600));
      const bicycle = await service.calculateEta({ ...BASE_PARAMS, transportMode: 'bicycle' });

      mockFetch.mockResolvedValue(makeOsrmOk(600));
      const walking = await service.calculateEta({ ...BASE_PARAMS, transportMode: 'walking' });

      expect(bicycle).toBe(780);
      expect(walking).toBe(780);
    });

    it('constructs OSRM URL with correct lng,lat order and profile', async () => {
      mockFetch.mockResolvedValue(makeOsrmOk(100));

      await service.calculateEta(BASE_PARAMS);

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('/route/v1/driving/');
      // OSRM expects lng,lat — not lat,lng
      expect(url).toContain(`${BASE_PARAMS.establishmentLng},${BASE_PARAMS.establishmentLat}`);
      expect(url).toContain(`${BASE_PARAMS.orderLng},${BASE_PARAMS.orderLat}`);
    });

    it('OSRM returns HTTP error → returns null', async () => {
      mockFetch.mockResolvedValue(makeHttpError(503));

      const result = await service.calculateEta(BASE_PARAMS);

      expect(result).toBeNull();
    });

    it('OSRM returns code !== Ok (NoRoute) → returns null', async () => {
      mockFetch.mockResolvedValue(makeOsrmBadCode('NoRoute'));

      const result = await service.calculateEta(BASE_PARAMS);

      expect(result).toBeNull();
    });

    it('fetch throws (network error / timeout) → returns null', async () => {
      mockFetch.mockRejectedValue(new Error('network error'));

      const result = await service.calculateEta(BASE_PARAMS);

      expect(result).toBeNull();
    });

    it('empty routes array → returns null', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ code: 'Ok', routes: [] }),
      });

      const result = await service.calculateEta(BASE_PARAMS);

      expect(result).toBeNull();
    });
  });

  // ── checkOverdueDeliveries ────────────────────────────────────────────────

  describe('checkOverdueDeliveries', () => {
    // delivery overdue by 15 min: started 30 min ago, ETA 10 min, delay 5 min
    const makeOverdueDelivery = (overrides: Record<string, unknown> = {}) => ({
      id: 'd1',
      eta_started_at: new Date(Date.now() - 30 * 60_000),
      eta_seconds: 600, // 10 min
      courier: { name: 'Ivan' },
      order: {
        address: 'вул. Хрещатик 1',
        establishment_id: 'est-1',
        establishment: {
          settings: { eta_alert_enabled: true, eta_alert_delay_minutes: 5 },
          timezone: 'UTC',
        },
      },
      ...overrides,
    });

    it('returns 0 when no in_progress deliveries with ETA', async () => {
      mockDelivery.findMany.mockResolvedValue([]);

      const result = await service.checkOverdueDeliveries();

      expect(result).toBe(0);
      expect(mockTelegramService.notifyEstablishmentManagers).not.toHaveBeenCalled();
    });

    it('skips delivery when eta_alert_enabled = false', async () => {
      mockDelivery.findMany.mockResolvedValue([
        {
          ...makeOverdueDelivery(),
          order: {
            address: 'addr',
            establishment_id: 'est-1',
            establishment: { settings: { eta_alert_enabled: false }, timezone: 'UTC' },
          },
        },
      ]);

      const result = await service.checkOverdueDeliveries();

      expect(result).toBe(0);
      expect(mockTelegramService.notifyEstablishmentManagers).not.toHaveBeenCalled();
    });

    it('skips delivery that is not yet overdue', async () => {
      // started 2 min ago, ETA 10 min, delay 5 min → overdue in 13 min from now
      mockDelivery.findMany.mockResolvedValue([
        makeOverdueDelivery({ eta_started_at: new Date(Date.now() - 2 * 60_000) }),
      ]);

      const result = await service.checkOverdueDeliveries();

      expect(result).toBe(0);
    });

    it('sends Telegram alert and sets eta_overdue_alerted_at when delivery is overdue', async () => {
      mockDelivery.findMany.mockResolvedValue([makeOverdueDelivery()]);

      const result = await service.checkOverdueDeliveries();

      expect(result).toBe(1);
      expect(mockTelegramService.notifyEstablishmentManagers).toHaveBeenCalledWith(
        'est-1',
        expect.stringContaining('Ivan'),
        'delivery_assigned',
      );
      expect(mockDelivery.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['d1'] } },
        data: { eta_overdue_alerted_at: expect.any(Date) },
      });
    });

    it('uses default 10-minute delay when eta_alert_delay_minutes is null', async () => {
      // started 25 min ago, ETA 10 min, delay null (default 10 min) → overdue by 5 min
      mockDelivery.findMany.mockResolvedValue([
        {
          ...makeOverdueDelivery({ eta_started_at: new Date(Date.now() - 25 * 60_000) }),
          order: {
            address: 'addr',
            establishment_id: 'est-1',
            establishment: {
              settings: { eta_alert_enabled: true, eta_alert_delay_minutes: null },
              timezone: 'UTC',
            },
          },
        },
      ]);

      const result = await service.checkOverdueDeliveries();

      expect(result).toBe(1);
    });

    it('batches multiple overdue deliveries into a single updateMany', async () => {
      const d2 = { ...makeOverdueDelivery(), id: 'd2', courier: { name: 'Petro' } };
      mockDelivery.findMany.mockResolvedValue([makeOverdueDelivery(), d2]);

      const result = await service.checkOverdueDeliveries();

      expect(result).toBe(2);
      expect(mockDelivery.updateMany).toHaveBeenCalledTimes(1);
      expect(mockDelivery.updateMany).toHaveBeenCalledWith({
        where: { id: { in: expect.arrayContaining(['d1', 'd2']) } },
        data: { eta_overdue_alerted_at: expect.any(Date) },
      });
    });
  });

  // ── checkAndMarkDeparture ─────────────────────────────────────────────────

  describe('checkAndMarkDeparture', () => {
    const EST_LAT = 50.45;
    const EST_LNG = 30.52;

    const makeActiveDelivery = () => ({
      id: 'd1',
      order: { establishment: { lat: EST_LAT, lng: EST_LNG } },
    });

    it('does nothing when no active in_progress delivery found', async () => {
      mockDelivery.findFirst.mockResolvedValue(null);

      await service.checkAndMarkDeparture('c1', 50.46, 30.53);

      expect(mockDelivery.update).not.toHaveBeenCalled();
    });

    it('does nothing when establishment has null coordinates', async () => {
      mockDelivery.findFirst.mockResolvedValue({
        id: 'd1',
        order: { establishment: { lat: null, lng: null } },
      });

      await service.checkAndMarkDeparture('c1', 50.46, 30.53);

      expect(mockDelivery.update).not.toHaveBeenCalled();
    });

    it('does not set eta_started_at when courier is at the establishment (0m)', async () => {
      mockDelivery.findFirst.mockResolvedValue(makeActiveDelivery());

      await service.checkAndMarkDeparture('c1', EST_LAT, EST_LNG);

      expect(mockDelivery.update).not.toHaveBeenCalled();
    });

    it('does not set eta_started_at when courier is within 100m threshold', async () => {
      mockDelivery.findFirst.mockResolvedValue(makeActiveDelivery());

      // ~50m north of establishment
      await service.checkAndMarkDeparture('c1', EST_LAT + 0.0004, EST_LNG);

      expect(mockDelivery.update).not.toHaveBeenCalled();
    });

    it('sets eta_started_at when courier is more than 100m from establishment', async () => {
      mockDelivery.findFirst.mockResolvedValue(makeActiveDelivery());

      // ~1.3 km northeast of establishment — clearly past 100m threshold
      await service.checkAndMarkDeparture('c1', 50.46, 30.53);

      expect(mockDelivery.update).toHaveBeenCalledWith({
        where: { id: 'd1' },
        data: { eta_started_at: expect.any(Date) },
      });
    });
  });
});
