import { Test, TestingModule } from '@nestjs/testing';
import { IikoService } from '../iiko.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { GeocodingService } from '../../geocoding/geocoding.service.js';
import { DistributedLockService } from '../../shared/redis/distributed-lock.service.js';
import { TelegramService } from '../../telegram/telegram.service.js';

// ── fetch mock ─────────────────────────────────────────────────────────────
const mockFetch = jest.fn();
global.fetch = mockFetch;

const mockOrder = {
  createMany: jest.fn().mockResolvedValue({ count: 1 }),
  findMany: jest.fn().mockResolvedValue([]),
};
const mockIntegration = { findMany: jest.fn() };
const mockPrisma = { integration: mockIntegration, order: mockOrder };
const mockGeocodingService = {
  enqueueGeocode: jest.fn().mockResolvedValue(undefined),
};
const mockTelegramService = {
  notifyEstablishmentManagers: jest.fn().mockResolvedValue(undefined),
};

// Call-through lock mock: lock is always acquired and fn executes immediately
const mockLock = {
  withLock: jest.fn((_key: string, _ttl: number, fn: () => Promise<void>) =>
    fn(),
  ),
} as unknown as DistributedLockService;

const VALID_CONFIG = {
  server_url: 'http://iiko-server:8080',
  login: 'admin',
  password: 'secret',
  organization_id: 'org-uuid-1',
};

const EST_ID = 'est-iiko-1';

// Helper to make a mock fetch response
const makeResponse = (status: number, body: unknown = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  text: () => Promise.resolve('session-token-abc'),
  json: () => Promise.resolve(body),
});

describe('IikoService', () => {
  let service: IikoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IikoService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: GeocodingService, useValue: mockGeocodingService },
        { provide: DistributedLockService, useValue: mockLock },
        { provide: TelegramService, useValue: mockTelegramService },
      ],
    }).compile();
    service = module.get<IikoService>(IikoService);
    jest.clearAllMocks();
    mockOrder.createMany.mockResolvedValue({ count: 1 });
  });

  // ── Happy path ─────────────────────────────────────────────────────────

  describe('pollEstablishment — happy path', () => {
    it('fetches token, polls orders, and creates new orders via createMany', async () => {
      mockFetch
        .mockResolvedValueOnce(makeResponse(200)) // auth → token
        .mockResolvedValueOnce(
          makeResponse(200, {
            deliveryOrders: [
              {
                id: 'iiko-1',
                address: 'вул. Тестова 1',
                latitude: 50.0,
                longitude: 30.0,
              },
            ],
          }),
        );
      mockOrder.createMany.mockResolvedValue({ count: 1 });

      await service.pollEstablishment(EST_ID, VALID_CONFIG);

      expect(mockOrder.createMany).toHaveBeenCalledTimes(1);
      expect(mockOrder.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            establishment_id: EST_ID,
            external_id: 'iiko-1',
            address: 'вул. Тестова 1',
            source: 'iiko',
          }),
        ]),
        skipDuplicates: true,
      });
    });

    it('skips already-ingested orders via skipDuplicates (idempotent)', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(200)).mockResolvedValueOnce(
        makeResponse(200, {
          deliveryOrders: [{ id: 'iiko-exists', address: 'Some St' }],
        }),
      );
      // DB reports 0 inserted because of duplicate skip
      mockOrder.createMany.mockResolvedValue({ count: 0 });

      await service.pollEstablishment(EST_ID, VALID_CONFIG);

      // createMany is called but inserts nothing — no separate check needed
      expect(mockOrder.createMany).toHaveBeenCalledTimes(1);
    });
  });

  // ── 429 / Exponential backoff ──────────────────────────────────────────

  describe('429 rate limiting — P0', () => {
    it('does NOT throw on 429 — records backoff and returns', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(429)); // auth returns 429

      await expect(
        service.pollEstablishment(EST_ID, VALID_CONFIG),
      ).resolves.not.toThrow();
    });

    it('sets backoff state after first 429', async () => {
      mockFetch.mockResolvedValue(makeResponse(429));

      await service.pollEstablishment(EST_ID, VALID_CONFIG);

      const state = service.getBackoffState(EST_ID);
      expect(state).toBeDefined();
      expect(state!.attempts).toBe(1);
      expect(state!.until).toBeGreaterThan(Date.now());
    });

    it('skips polling (without calling fetch) while backing off', async () => {
      // Trigger backoff
      mockFetch.mockResolvedValueOnce(makeResponse(429));
      await service.pollEstablishment(EST_ID, VALID_CONFIG);

      // Second call — should be skipped
      mockFetch.mockClear();
      await service.pollEstablishment(EST_ID, VALID_CONFIG);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('doubles backoff delay on each consecutive 429', async () => {
      mockFetch.mockResolvedValue(makeResponse(429));

      await service.pollEstablishment(EST_ID, VALID_CONFIG);
      const state1 = { ...service.getBackoffState(EST_ID)! };

      // Force backoff to expire by resetting until
      (service as any).backoff.set(EST_ID, { ...state1, until: 0 });

      await service.pollEstablishment(EST_ID, VALID_CONFIG);
      const state2 = service.getBackoffState(EST_ID)!;

      expect(state2.attempts).toBe(2);
      // delay should be doubled
      const delay1 = state1.until - Date.now();
      const delay2 = state2.until - Date.now();
      expect(delay2).toBeGreaterThan(delay1);
    });

    it('clears backoff state on successful poll', async () => {
      // First set a backoff
      mockFetch.mockResolvedValue(makeResponse(429));
      await service.pollEstablishment(EST_ID, VALID_CONFIG);
      expect(service.getBackoffState(EST_ID)).toBeDefined();

      // Expire the backoff
      (service as any).backoff.set(EST_ID, { until: 0, attempts: 1 });

      // Now succeed
      mockFetch
        .mockResolvedValueOnce(makeResponse(200))
        .mockResolvedValueOnce(makeResponse(200, { deliveryOrders: [] }));
      await service.pollEstablishment(EST_ID, VALID_CONFIG);

      expect(service.getBackoffState(EST_ID)).toBeUndefined();
    });
  });

  // ── Config validation ──────────────────────────────────────────────────

  describe('config validation', () => {
    it('skips polling when config is incomplete', async () => {
      await service.pollEstablishment(EST_ID, { server_url: 'http://iiko' }); // missing login/password

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ── pollAll ────────────────────────────────────────────────────────────

  describe('pollAll', () => {
    it('iterates all active iiko integrations', async () => {
      mockIntegration.findMany.mockResolvedValue([
        { establishment_id: 'est-a', config: VALID_CONFIG },
        { establishment_id: 'est-b', config: VALID_CONFIG },
      ]);
      mockFetch
        .mockResolvedValue(makeResponse(200)) // auth for both
        .mockResolvedValue(makeResponse(200, { deliveryOrders: [] })); // orders for both

      await service.pollAll();

      expect(mockIntegration.findMany).toHaveBeenCalledWith({
        where: { type: 'iiko', active: true },
      });
    });

    it('continues polling other establishments if one fails', async () => {
      mockIntegration.findMany.mockResolvedValue([
        { establishment_id: 'est-fail', config: VALID_CONFIG },
        { establishment_id: 'est-ok', config: VALID_CONFIG },
      ]);
      mockFetch
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValueOnce(makeResponse(200))
        .mockResolvedValueOnce(makeResponse(200, { deliveryOrders: [] }));

      await expect(service.pollAll()).resolves.not.toThrow();
    });

    it('acquires distributed lock with key "iiko-poll" and TTL 90s', async () => {
      mockIntegration.findMany.mockResolvedValue([]);

      await service.pollAll();

      expect(mockLock.withLock).toHaveBeenCalledWith(
        'iiko-poll',
        90,
        expect.any(Function),
      );
    });
  });

  // ── Geocoding integration ──────────────────────────────────────────────────

  describe('geocoding', () => {
    it('does NOT enqueue geocoding when all orders already have coords in DB', async () => {
      mockFetch
        .mockReset()
        .mockResolvedValueOnce(makeResponse(200))
        .mockResolvedValueOnce(
          makeResponse(200, {
            deliveryOrders: [
              {
                id: 'iiko-with-coords',
                address: 'вул. Тестова 1',
                latitude: 50.0,
                longitude: 30.0,
              },
            ],
          }),
        );
      // POS coords are ignored — service checks DB for lat=null orders;
      // none found means nothing to geocode
      mockOrder.findMany.mockResolvedValue([]);

      await service.pollEstablishment(EST_ID, VALID_CONFIG);

      expect(mockOrder.findMany).toHaveBeenCalledWith({
        where: {
          establishment_id: EST_ID,
          external_id: { in: ['iiko-with-coords'] },
          lat: null,
        },
        select: { id: true, address: true },
      });
      expect(mockGeocodingService.enqueueGeocode).not.toHaveBeenCalled();
    });

    it('enqueues geocoding for orders without coordinates', async () => {
      mockFetch
        .mockReset()
        .mockResolvedValueOnce(makeResponse(200))
        .mockResolvedValueOnce(
          makeResponse(200, {
            deliveryOrders: [
              { id: 'iiko-no-coords', address: 'вул. Хрещатик 10' },
            ],
          }),
        );
      mockOrder.findMany.mockResolvedValue([
        { id: 'db-order-id', address: 'вул. Хрещатик 10' },
      ]);

      await service.pollEstablishment(EST_ID, VALID_CONFIG);

      expect(mockOrder.findMany).toHaveBeenCalledWith({
        where: {
          establishment_id: EST_ID,
          external_id: { in: ['iiko-no-coords'] },
          lat: null,
        },
        select: { id: true, address: true },
      });
      expect(mockGeocodingService.enqueueGeocode).toHaveBeenCalledWith(
        'db-order-id',
        'вул. Хрещатик 10',
        EST_ID,
      );
    });

    it('does NOT enqueue geocoding when address is "Unknown"', async () => {
      mockFetch
        .mockReset()
        .mockResolvedValueOnce(makeResponse(200))
        .mockResolvedValueOnce(
          makeResponse(200, {
            deliveryOrders: [{ id: 'iiko-unknown', address: undefined }],
          }),
        );

      await service.pollEstablishment(EST_ID, VALID_CONFIG);

      expect(mockGeocodingService.enqueueGeocode).not.toHaveBeenCalled();
    });
  });
});
