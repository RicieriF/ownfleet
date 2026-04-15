import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EtaService, EtaParams } from './eta.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TelegramService } from '../telegram/telegram.service.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function mockOsrmResponse(durationSeconds: number) {
  return {
    ok: true,
    json: jest.fn().mockResolvedValue({
      code: 'Ok',
      routes: [{ duration: durationSeconds }],
    }),
  } as unknown as Response;
}

/**
 * Shift a lat/lng by approximately `meters` in the north direction.
 * 1 degree latitude ≈ 111_000 m.
 */
function shiftLatByMeters(lat: number, meters: number) {
  return lat + meters / 111_000;
}

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockPrisma = {
  delivery: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
};

const mockTelegram = {
  notifyEstablishmentManagers: jest.fn(),
};

// ── Setup ──────────────────────────────────────────────────────────────────

describe('EtaService', () => {
  let service: EtaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EtaService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TelegramService, useValue: mockTelegram },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<EtaService>(EtaService);
    jest.clearAllMocks();
    // Ensure fire-and-forget Telegram calls don't leak unhandled rejections
    mockTelegram.notifyEstablishmentManagers.mockResolvedValue(undefined);
  });

  // ── calculateEta ─────────────────────────────────────────────────────────

  describe('calculateEta', () => {
    const baseParams: EtaParams = {
      establishmentLat: 50.45,
      establishmentLng: 30.52,
      orderLat: 50.46,
      orderLng: 30.53,
      transportMode: 'car',
      timezone: 'Europe/London', // use a timezone where we can control peak vs off-peak
    };

    it('returns route duration + 3-min buffer (off-peak, car)', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue(mockOsrmResponse(600)); // 10 min

      // Pin the time to an off-peak hour (e.g. 10:00 UTC in Europe/London during winter)
      jest.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('10');

      const result = await service.calculateEta(baseParams);

      // 600 * 1.0 (no peak) + 180 buffer = 780
      expect(result).toBe(780);
    });

    it('applies 1.3× peak coefficient during morning rush', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue(mockOsrmResponse(600));
      // Simulate 08:00 — inside 07–09 peak window
      jest.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('8');

      const result = await service.calculateEta(baseParams);

      // 600 * 1.3 + 180 = 960
      expect(result).toBe(960);
    });

    it('applies 1.3× peak coefficient during evening rush', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue(mockOsrmResponse(600));
      jest.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('17');

      const result = await service.calculateEta(baseParams);

      expect(result).toBe(960);
    });

    it('does not apply peak coefficient at the boundary hour (09:00)', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue(mockOsrmResponse(600));
      jest.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('9');

      const result = await service.calculateEta(baseParams);

      // 09:00 is NOT in [7,9) → off-peak
      expect(result).toBe(780);
    });

    it('applies moto_electric speed correction (×1.43) before peak/buffer', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue(mockOsrmResponse(350));
      jest.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('10'); // off-peak

      const result = await service.calculateEta({
        ...baseParams,
        transportMode: 'moto_electric',
      });

      const corrected = 350 * (50 / 35); // ≈ 500
      const expected = Math.round(corrected + 180);
      expect(result).toBe(expected);
    });

    it('uses driving profile for moto_gas (same URL pattern as car)', async () => {
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(mockOsrmResponse(300));
      jest.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('10');

      await service.calculateEta({ ...baseParams, transportMode: 'moto_gas' });

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/route/v1/driving/'),
        expect.any(Object),
      );
    });

    it('uses cycling profile for bicycle', async () => {
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(mockOsrmResponse(300));
      jest.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('10');

      await service.calculateEta({ ...baseParams, transportMode: 'bicycle' });

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/route/v1/cycling/'),
        expect.any(Object),
      );
    });

    it('uses foot profile for walking', async () => {
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(mockOsrmResponse(300));
      jest.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('10');

      await service.calculateEta({ ...baseParams, transportMode: 'walking' });

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/route/v1/foot/'),
        expect.any(Object),
      );
    });

    it('returns null when OSRM responds with non-ok HTTP status', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue({ ok: false, status: 503 } as Response);

      const result = await service.calculateEta(baseParams);

      expect(result).toBeNull();
    });

    it('returns null when OSRM returns code !== Ok', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ code: 'NoRoute', routes: [] }),
      } as unknown as Response);

      const result = await service.calculateEta(baseParams);

      expect(result).toBeNull();
    });

    it('returns null when OSRM returns empty routes array', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ code: 'Ok', routes: [] }),
      } as unknown as Response);

      const result = await service.calculateEta(baseParams);

      expect(result).toBeNull();
    });

    it('returns null when fetch throws (network error)', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockRejectedValue(new Error('Network failure'));

      const result = await service.calculateEta(baseParams);

      expect(result).toBeNull();
    });

    it('orders coordinates as lng,lat in OSRM URL (lon first)', async () => {
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(mockOsrmResponse(300));
      jest.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('10');

      await service.calculateEta({
        establishmentLat: 50.45,
        establishmentLng: 30.52,
        orderLat: 50.46,
        orderLng: 30.53,
        transportMode: 'car',
        timezone: 'Europe/Kyiv',
      });

      // OSRM expects lng,lat;lng,lat
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('30.52,50.45;30.53,50.46'),
        expect.any(Object),
      );
    });
  });

  // ── checkAndMarkDeparture ─────────────────────────────────────────────────

  describe('checkAndMarkDeparture', () => {
    const EST_LAT = 50.45;
    const EST_LNG = 30.52;

    const deliveryWithEstablishment = (
      lat: number | null,
      lng: number | null,
    ) => ({
      id: 'delivery-1',
      order: {
        establishment: { lat, lng },
      },
    });

    it('returns early when no in_progress delivery found', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValue(null);

      await service.checkAndMarkDeparture('courier-1', 50.45, 30.52);

      expect(mockPrisma.delivery.update).not.toHaveBeenCalled();
    });

    it('returns early when establishment has null coordinates', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValue(
        deliveryWithEstablishment(null, null),
      );

      await service.checkAndMarkDeparture('courier-1', 50.46, 30.53);

      expect(mockPrisma.delivery.update).not.toHaveBeenCalled();
    });

    it('does not start timer when courier is within 100m of establishment', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValue(
        deliveryWithEstablishment(EST_LAT, EST_LNG),
      );

      // ~50m north — well within threshold
      const nearLat = shiftLatByMeters(EST_LAT, 50);
      await service.checkAndMarkDeparture('courier-1', nearLat, EST_LNG);

      expect(mockPrisma.delivery.update).not.toHaveBeenCalled();
    });

    it('does not start timer when courier is 90m from establishment', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValue(
        deliveryWithEstablishment(EST_LAT, EST_LNG),
      );

      // ~90m — clearly below the 100m threshold, should NOT trigger
      const nearLat = shiftLatByMeters(EST_LAT, 90);
      await service.checkAndMarkDeparture('courier-1', nearLat, EST_LNG);

      expect(mockPrisma.delivery.update).not.toHaveBeenCalled();
    });

    it('sets eta_started_at when courier is beyond 100m from establishment', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValue(
        deliveryWithEstablishment(EST_LAT, EST_LNG),
      );
      mockPrisma.delivery.update.mockResolvedValue({});

      // ~250m north — clearly beyond threshold
      const farLat = shiftLatByMeters(EST_LAT, 250);
      await service.checkAndMarkDeparture('courier-1', farLat, EST_LNG);

      expect(mockPrisma.delivery.update).toHaveBeenCalledWith({
        where: { id: 'delivery-1' },
        data: { eta_started_at: expect.any(Date) },
      });
    });

    it('queries only the correct courier and in_progress status', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValue(null);

      await service.checkAndMarkDeparture('courier-42', 50.45, 30.52);

      expect(mockPrisma.delivery.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            courier_id: 'courier-42',
            status: 'in_progress',
            eta_seconds: { not: null },
            eta_started_at: null,
          }),
        }),
      );
    });
  });

  // ── checkOverdueDeliveries ────────────────────────────────────────────────

  describe('checkOverdueDeliveries', () => {
    function makeDelivery(opts: {
      id?: string;
      etaSeconds: number;
      startedMsAgo: number;
      etaAlertEnabled?: boolean;
      etaAlertDelayMinutes?: number;
      establishmentId?: string;
      courierName?: string;
      address?: string;
    }) {
      const now = Date.now();
      return {
        id: opts.id ?? 'delivery-1',
        eta_seconds: opts.etaSeconds,
        eta_started_at: new Date(now - opts.startedMsAgo),
        courier: { name: opts.courierName ?? 'Іван' },
        order: {
          address: opts.address ?? 'вул. Хрещатик, 1',
          establishment_id: opts.establishmentId ?? 'est-1',
          establishment: {
            settings: {
              eta_alert_enabled: opts.etaAlertEnabled ?? true,
              eta_alert_delay_minutes: opts.etaAlertDelayMinutes ?? 10,
            },
            timezone: 'Europe/Kyiv',
          },
        },
      };
    }

    it('returns 0 when there are no eligible deliveries', async () => {
      mockPrisma.delivery.findMany.mockResolvedValue([]);

      const result = await service.checkOverdueDeliveries();

      expect(result).toBe(0);
      expect(mockTelegram.notifyEstablishmentManagers).not.toHaveBeenCalled();
    });

    it('returns 0 when eta_alert_enabled is false', async () => {
      const delivery = makeDelivery({
        etaSeconds: 600,
        startedMsAgo: 700_000, // well overdue
        etaAlertEnabled: false,
      });
      mockPrisma.delivery.findMany.mockResolvedValue([delivery]);

      const result = await service.checkOverdueDeliveries();

      expect(result).toBe(0);
      expect(mockPrisma.delivery.updateMany).not.toHaveBeenCalled();
    });

    it('returns 0 when delivery is not yet past the configured delay', async () => {
      // ETA is 600s (10 min), delay is 10 min → alert fires at 20 min after start
      // Only 15 min elapsed → not yet overdue
      const delivery = makeDelivery({
        etaSeconds: 600,
        startedMsAgo: 15 * 60_000, // 15 minutes ago
        etaAlertDelayMinutes: 10,
      });
      mockPrisma.delivery.findMany.mockResolvedValue([delivery]);

      const result = await service.checkOverdueDeliveries();

      expect(result).toBe(0);
    });

    it('sends Telegram alert and updates eta_overdue_alerted_at when overdue', async () => {
      // ETA 600s, delay 5min → alert fires at 15min. 20min elapsed → overdue.
      const delivery = makeDelivery({
        etaSeconds: 600,
        startedMsAgo: 20 * 60_000,
        etaAlertDelayMinutes: 5,
        establishmentId: 'est-99',
        courierName: 'Петро',
        address: 'вул. Лесі Українки, 5',
      });
      mockPrisma.delivery.findMany.mockResolvedValue([delivery]);
      mockPrisma.delivery.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.checkOverdueDeliveries();

      expect(result).toBe(1);
      expect(mockTelegram.notifyEstablishmentManagers).toHaveBeenCalledWith(
        'est-99',
        expect.stringContaining('Петро'),
        'delivery_assigned',
      );
      expect(mockTelegram.notifyEstablishmentManagers).toHaveBeenCalledWith(
        'est-99',
        expect.stringContaining('вул. Лесі Українки, 5'),
        'delivery_assigned',
      );
      expect(mockPrisma.delivery.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['delivery-1'] } },
        data: { eta_overdue_alerted_at: expect.any(Date) },
      });
    });

    it('handles multiple deliveries independently — only alerts overdue ones', async () => {
      const overdueDelivery = makeDelivery({
        id: 'delivery-overdue',
        etaSeconds: 300,
        startedMsAgo: 25 * 60_000, // overdue
        etaAlertDelayMinutes: 10,
      });
      const notYetOverdueDelivery = makeDelivery({
        id: 'delivery-pending',
        etaSeconds: 1200,
        startedMsAgo: 5 * 60_000, // 5 min into a 20-min delivery
        etaAlertDelayMinutes: 10,
      });
      mockPrisma.delivery.findMany.mockResolvedValue([
        overdueDelivery,
        notYetOverdueDelivery,
      ]);
      mockPrisma.delivery.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.checkOverdueDeliveries();

      expect(result).toBe(1);
      expect(mockPrisma.delivery.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['delivery-overdue'] } },
        }),
      );
    });

    it('uses default delay of 10 minutes when eta_alert_delay_minutes is null', async () => {
      // ETA 600s, null delay (defaults to 10min) → alert at 20min. 25min elapsed → overdue.
      const delivery = makeDelivery({
        etaSeconds: 600,
        startedMsAgo: 25 * 60_000,
        etaAlertEnabled: true,
        etaAlertDelayMinutes: undefined,
      });
      // Override settings to have null delay
      delivery.order.establishment.settings = {
        eta_alert_enabled: true,
        eta_alert_delay_minutes: null as unknown as number,
      };
      mockPrisma.delivery.findMany.mockResolvedValue([delivery]);
      mockPrisma.delivery.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.checkOverdueDeliveries();

      expect(result).toBe(1);
    });

    it('Telegram failure does not prevent eta_overdue_alerted_at update', async () => {
      const delivery = makeDelivery({
        etaSeconds: 300,
        startedMsAgo: 30 * 60_000,
        etaAlertDelayMinutes: 5,
      });
      mockPrisma.delivery.findMany.mockResolvedValue([delivery]);
      mockPrisma.delivery.updateMany.mockResolvedValue({ count: 1 });
      mockTelegram.notifyEstablishmentManagers.mockRejectedValue(
        new Error('Telegram down'),
      );

      // Should not throw
      const result = await service.checkOverdueDeliveries();

      expect(result).toBe(1);
      expect(mockPrisma.delivery.updateMany).toHaveBeenCalled();
    });

    it('queries only in_progress deliveries without prior alert', async () => {
      mockPrisma.delivery.findMany.mockResolvedValue([]);

      await service.checkOverdueDeliveries();

      expect(mockPrisma.delivery.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'in_progress',
            eta_started_at: { not: null },
            eta_seconds: { not: null },
            eta_overdue_alerted_at: null,
          }),
        }),
      );
    });
  });
});
