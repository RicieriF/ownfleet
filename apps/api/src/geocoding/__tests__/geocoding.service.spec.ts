import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bull';
import { GeocodingService } from '../geocoding.service.js';
import { GEOCODING_QUEUE } from '../geocoding.constants.js';
import { REDIS_CLIENT } from '../../shared/redis/redis.constants.js';

// ── fetch mock ──────────────────────────────────────────────────────────────
const mockFetch = jest.fn();
global.fetch = mockFetch;

const makeResponse = (status: number, body: unknown = []) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

// ── Redis mock ──────────────────────────────────────────────────────────────
const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
};

// ── Queue mock ──────────────────────────────────────────────────────────────
const mockQueue = { add: jest.fn() };

describe('GeocodingService', () => {
  let service: GeocodingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeocodingService,
        { provide: getQueueToken(GEOCODING_QUEUE), useValue: mockQueue },
        { provide: REDIS_CLIENT, useValue: mockRedis },
        {
          provide: ConfigService,
          useValue: { get: () => undefined, getOrThrow: () => 'redis://localhost' },
        },
      ],
    }).compile();

    service = module.get<GeocodingService>(GeocodingService);
    jest.clearAllMocks();
    mockRedis.get.mockResolvedValue(null); // cache miss by default
    mockRedis.set.mockResolvedValue('OK');
  });

  // ── geocode() ─────────────────────────────────────────────────────────────

  describe('geocode()', () => {
    it('returns cached coords without calling Nominatim', async () => {
      const cached = { lat: 50.45, lng: 30.52 };
      mockRedis.get.mockResolvedValue(JSON.stringify(cached));

      const result = await service.geocode('вул. Хрещатик 1, Київ');

      expect(result).toEqual(cached);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('calls Nominatim on cache miss, caches and returns coords', async () => {
      mockFetch.mockResolvedValue(
        makeResponse(200, [{ lat: '50.4501', lon: '30.5234' }]),
      );

      const result = await service.geocode('вул. Тестова 5, Київ');

      expect(result).toEqual({ lat: 50.4501, lng: 30.5234 });
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringMatching(/^geocode:/),
        JSON.stringify({ lat: 50.4501, lng: 30.5234 }),
        'EX',
        30 * 24 * 3600,
      );
    });

    it('returns null and caches negative result when Nominatim returns empty array', async () => {
      mockFetch.mockResolvedValue(makeResponse(200, []));

      const result = await service.geocode('повна нісенітниця xyz123');

      expect(result).toBeNull();
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringMatching(/^geocode:/),
        'null',
        'EX',
        3600,
      );
    });

    it('returns null immediately on negative cache hit without calling Nominatim', async () => {
      mockRedis.get.mockResolvedValue('null');

      const result = await service.geocode('повна нісенітниця xyz123');

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns null on Nominatim HTTP error', async () => {
      mockFetch.mockResolvedValue(makeResponse(500));

      const result = await service.geocode('вул. Тестова 1');

      expect(result).toBeNull();
    });

    it('returns null and logs warning on 2s timeout', async () => {
      mockFetch.mockImplementation(
        () => new Promise((_, reject) => {
          const err = new Error('The operation was aborted');
          (err as NodeJS.ErrnoException).name = 'AbortError';
          setTimeout(() => reject(err), 50);
        }),
      );

      const result = await service.geocode('вул. Повільна 1');

      expect(result).toBeNull();
      expect(mockRedis.set).not.toHaveBeenCalled();
    });

    it('returns null on unexpected fetch error without throwing', async () => {
      mockFetch.mockRejectedValue(new Error('network error'));

      await expect(service.geocode('вул. Тестова 1')).resolves.toBeNull();
    });

    it('uses the same cache key for same address regardless of case/whitespace', async () => {
      mockFetch.mockResolvedValue(
        makeResponse(200, [{ lat: '50.45', lon: '30.52' }]),
      );

      // First call — populate cache
      await service.geocode('  вул. Хрещатик 1  ');
      const cacheKey = (mockRedis.set as jest.Mock).mock.calls[0][0] as string;

      // Simulate cache hit for the same normalized key
      mockRedis.get.mockImplementation((key: string) =>
        key === cacheKey ? JSON.stringify({ lat: 50.45, lng: 30.52 }) : null,
      );
      mockFetch.mockClear();

      // Second call with different casing — should hit cache, not Nominatim
      const result = await service.geocode('ВУЛ. ХРЕЩАТИК 1');
      expect(mockFetch).not.toHaveBeenCalled();
      expect(result).toEqual({ lat: 50.45, lng: 30.52 });
    });
  });

  // ── enqueueGeocode() ──────────────────────────────────────────────────────

  describe('enqueueGeocode()', () => {
    it('adds a job with jobId=orderId to prevent duplicate enqueue', async () => {
      mockQueue.add.mockResolvedValue({});

      await service.enqueueGeocode('order-1', 'вул. Тестова 5');

      expect(mockQueue.add).toHaveBeenCalledWith(
        { orderId: 'order-1', address: 'вул. Тестова 5' },
        { jobId: 'order-1' },
      );
    });

    it('does not add a job for "Unknown" address', async () => {
      await service.enqueueGeocode('order-2', 'Unknown');
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('does not add a job for empty address', async () => {
      await service.enqueueGeocode('order-3', '');
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('does not add a job for whitespace-only address', async () => {
      await service.enqueueGeocode('order-5', '   ');
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('logs warning and does not throw when queue.add fails', async () => {
      mockQueue.add.mockRejectedValue(new Error('Redis unavailable'));

      await expect(
        service.enqueueGeocode('order-4', 'вул. Тестова 5'),
      ).resolves.not.toThrow();
    });
  });
});
