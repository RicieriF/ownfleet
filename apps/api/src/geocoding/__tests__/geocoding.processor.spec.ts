import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { Prisma } from '@prisma/client';
import {
  GeocodingProcessor,
  GEOCODING_DONE_CHANNEL,
  GEOCODING_FAILED_CHANNEL,
} from '../processors/geocoding.processor.js';
import { GeocodingService } from '../geocoding.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TelegramService } from '../../telegram/telegram.service.js';
import { REDIS_CLIENT } from '../../shared/redis/redis.constants.js';
import type { Job } from 'bull';
import type { GeocodeJob } from '../geocoding.service.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockGeocodingService = { geocode: jest.fn() };
const mockTelegramService = {
  notifyEstablishmentManagers: jest.fn().mockResolvedValue(undefined),
};
const mockDispatchQueue = { add: jest.fn() };

const mockOrder = { update: jest.fn(), findUnique: jest.fn() };
const mockEstablishment = { findUnique: jest.fn() };
const mockPrisma = { order: mockOrder, establishment: mockEstablishment };

// Redis mock: get returns null by default (no dedup), set + publish are no-ops
const mockRedis = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  publish: jest.fn().mockResolvedValue(1),
};

const makeJob = (data: GeocodeJob): Job<GeocodeJob> =>
  ({ data }) as Job<GeocodeJob>;

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Establishment in Kyiv center with coordinates set. */
const EST_WITH_COORDS = { city: 'Київ', lat: 50.45, lng: 30.52 };
/** Establishment with city but no coordinates (cannot run proximity check). */
const EST_NO_COORDS = { city: 'Київ', lat: null, lng: null };

describe('GeocodingProcessor', () => {
  let processor: GeocodingProcessor;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeocodingProcessor,
        { provide: GeocodingService, useValue: mockGeocodingService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TelegramService, useValue: mockTelegramService },
        { provide: getQueueToken('dispatch'), useValue: mockDispatchQueue },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    processor = module.get<GeocodingProcessor>(GeocodingProcessor);
    jest.clearAllMocks();

    // Sensible defaults
    mockRedis.get.mockResolvedValue(null); // no dedup key by default
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.publish.mockResolvedValue(1);
    mockEstablishment.findUnique.mockResolvedValue(EST_WITH_COORDS);
    mockOrder.update.mockResolvedValue({});
    mockOrder.findUnique.mockResolvedValue({ status: 'pending' });
    mockTelegramService.notifyEstablishmentManagers.mockResolvedValue(
      undefined,
    );
  });

  // ── Success path ──────────────────────────────────────────────────────────

  it('updates order, publishes geocoding:done, and triggers auto-dispatch on success', async () => {
    // Coords are within 25 km of the establishment
    mockGeocodingService.geocode.mockResolvedValue({ lat: 50.44, lng: 30.51 });
    mockEstablishment.findUnique
      .mockResolvedValueOnce(EST_WITH_COORDS) // handle() call
      .mockResolvedValueOnce({ dispatch_mode: 'auto' }); // triggerAutoDispatch call

    await processor.handle(
      makeJob({
        orderId: 'order-1',
        address: 'вул. Тестова 5',
        establishmentId: 'est-1',
      }),
    );

    expect(mockOrder.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { lat: 50.44, lng: 30.51 },
    });
    expect(mockRedis.publish).toHaveBeenCalledWith(
      GEOCODING_DONE_CHANNEL,
      JSON.stringify({
        orderId: 'order-1',
        lat: 50.44,
        lng: 30.51,
        establishmentId: 'est-1',
      }),
    );
    expect(mockDispatchQueue.add).toHaveBeenCalledWith(
      { orderId: 'order-1', establishmentId: 'est-1', attempt: 1 },
      { jobId: 'dispatch:order-1' },
    );
    expect(
      mockTelegramService.notifyEstablishmentManagers,
    ).not.toHaveBeenCalled();
  });

  it('does not trigger auto-dispatch when order is not pending', async () => {
    mockGeocodingService.geocode.mockResolvedValue({ lat: 50.44, lng: 30.51 });
    mockEstablishment.findUnique
      .mockResolvedValueOnce(EST_WITH_COORDS)
      .mockResolvedValueOnce({ dispatch_mode: 'auto' });
    mockOrder.findUnique.mockResolvedValue({ status: 'assigned' }); // already assigned

    await processor.handle(
      makeJob({
        orderId: 'order-1',
        address: 'вул. Тестова 5',
        establishmentId: 'est-1',
      }),
    );

    expect(mockDispatchQueue.add).not.toHaveBeenCalled();
  });

  it('does not trigger auto-dispatch when dispatch_mode is manual', async () => {
    mockGeocodingService.geocode.mockResolvedValue({ lat: 50.44, lng: 30.51 });
    mockEstablishment.findUnique
      .mockResolvedValueOnce(EST_WITH_COORDS)
      .mockResolvedValueOnce({ dispatch_mode: 'manual' });

    await processor.handle(
      makeJob({
        orderId: 'order-1',
        address: 'вул. Тестова 5',
        establishmentId: 'est-1',
      }),
    );

    expect(mockDispatchQueue.add).not.toHaveBeenCalled();
  });

  // ── Proximity validation ──────────────────────────────────────────────────

  it('rejects geocode result > 25 km from establishment and sends alert', async () => {
    // Coords in Kharkiv (~480 km from Kyiv)
    mockGeocodingService.geocode.mockResolvedValue({ lat: 49.99, lng: 36.23 });

    await processor.handle(
      makeJob({
        orderId: 'order-2',
        address: 'вул. Шевченка 1',
        establishmentId: 'est-1',
      }),
    );

    expect(mockOrder.update).not.toHaveBeenCalled();
    expect(mockRedis.publish).toHaveBeenCalledWith(
      GEOCODING_FAILED_CHANNEL,
      expect.stringContaining('"reason":"proximity_failed"'),
    );
    expect(
      mockTelegramService.notifyEstablishmentManagers,
    ).toHaveBeenCalledWith(
      'est-1',
      expect.stringContaining(
        'proximity_failed'.length > 0 ? 'занадто далеко' : '',
      ),
      'geocode_failed',
    );
  });

  it('accepts coords within 25 km even if not identical to establishment', async () => {
    // ~15 km from establishment — valid delivery distance
    mockGeocodingService.geocode.mockResolvedValue({ lat: 50.32, lng: 30.45 });
    mockEstablishment.findUnique
      .mockResolvedValueOnce(EST_WITH_COORDS)
      .mockResolvedValueOnce({ dispatch_mode: 'manual' });

    await processor.handle(
      makeJob({
        orderId: 'order-3',
        address: 'вул. Лісова 5',
        establishmentId: 'est-1',
      }),
    );

    expect(mockOrder.update).toHaveBeenCalled();
    expect(
      mockTelegramService.notifyEstablishmentManagers,
    ).not.toHaveBeenCalled();
  });

  it('skips proximity check when establishment has no coordinates', async () => {
    mockGeocodingService.geocode.mockResolvedValue({ lat: 49.99, lng: 36.23 });
    mockEstablishment.findUnique
      .mockResolvedValueOnce(EST_NO_COORDS)
      .mockResolvedValueOnce({ dispatch_mode: 'manual' });

    // Should NOT reject — we cannot validate without establishment coords
    await processor.handle(
      makeJob({
        orderId: 'order-4',
        address: 'вул. Тестова 1',
        establishmentId: 'est-1',
      }),
    );

    expect(mockOrder.update).toHaveBeenCalled();
  });

  // ── Geocoding returns null ────────────────────────────────────────────────

  it('sends alert and does not update order when geocode returns null (address not found)', async () => {
    mockGeocodingService.geocode.mockResolvedValue(null);

    await processor.handle(
      makeJob({
        orderId: 'order-5',
        address: 'повна нісенітниця xyz123',
        establishmentId: 'est-1',
      }),
    );

    expect(mockOrder.update).not.toHaveBeenCalled();
    expect(mockRedis.publish).toHaveBeenCalledWith(
      GEOCODING_FAILED_CHANNEL,
      expect.stringContaining('"reason":"not_found"'),
    );
    expect(
      mockTelegramService.notifyEstablishmentManagers,
    ).toHaveBeenCalledWith('est-1', expect.any(String), 'geocode_failed');
  });

  it('does not send duplicate alert within 24h (Redis dedup)', async () => {
    mockGeocodingService.geocode.mockResolvedValue(null);
    mockRedis.get.mockResolvedValue('not_found'); // dedup key already set

    await processor.handle(
      makeJob({ orderId: 'order-5', address: 'xyz', establishmentId: 'est-1' }),
    );

    expect(
      mockTelegramService.notifyEstablishmentManagers,
    ).not.toHaveBeenCalled();
    expect(mockRedis.publish).not.toHaveBeenCalledWith(
      GEOCODING_FAILED_CHANNEL,
      expect.anything(),
    );
  });

  // ── Transient failure path ────────────────────────────────────────────────

  it('propagates geocode error so Bull retries the job', async () => {
    mockGeocodingService.geocode.mockRejectedValue(
      new Error('Nominatim HTTP 503'),
    );

    await expect(
      processor.handle(
        makeJob({
          orderId: 'order-6',
          address: 'вул. Тестова 1',
          establishmentId: 'est-1',
        }),
      ),
    ).rejects.toThrow('Nominatim HTTP 503');

    expect(mockOrder.update).not.toHaveBeenCalled();
  });

  it('sends alert via onFailed after all Bull retries are exhausted', async () => {
    const job = makeJob({
      orderId: 'order-7',
      address: 'вул. Тестова 1',
      establishmentId: 'est-1',
    });
    const err = new Error('Nominatim timeout');

    await processor.onFailed(job, err);

    expect(mockRedis.publish).toHaveBeenCalledWith(
      GEOCODING_FAILED_CHANNEL,
      expect.stringContaining('"reason":"transient_failure"'),
    );
    expect(
      mockTelegramService.notifyEstablishmentManagers,
    ).toHaveBeenCalledWith('est-1', expect.any(String), 'geocode_failed');
  });

  // ── DB errors ─────────────────────────────────────────────────────────────

  it('does not publish geocoding:done when DB update throws', async () => {
    mockGeocodingService.geocode.mockResolvedValue({ lat: 50.44, lng: 30.51 });
    mockEstablishment.findUnique.mockResolvedValueOnce(EST_WITH_COORDS);
    mockOrder.update.mockRejectedValue(new Error('DB error'));

    await expect(
      processor.handle(
        makeJob({
          orderId: 'order-8',
          address: 'вул. Тестова 5',
          establishmentId: 'est-1',
        }),
      ),
    ).rejects.toThrow('DB error');

    expect(mockRedis.publish).not.toHaveBeenCalledWith(
      GEOCODING_DONE_CHANNEL,
      expect.anything(),
    );
  });

  it('silently skips when order was deleted before geocoding completed (P2025)', async () => {
    mockGeocodingService.geocode.mockResolvedValue({ lat: 50.44, lng: 30.51 });
    mockEstablishment.findUnique.mockResolvedValueOnce(EST_WITH_COORDS);
    const p2025 = new Prisma.PrismaClientKnownRequestError('Record not found', {
      code: 'P2025',
      clientVersion: '5.0.0',
    });
    mockOrder.update.mockRejectedValue(p2025);

    // Should not throw
    await processor.handle(
      makeJob({
        orderId: 'order-9',
        address: 'вул. Тестова 5',
        establishmentId: 'est-1',
      }),
    );

    expect(mockRedis.publish).not.toHaveBeenCalledWith(
      GEOCODING_DONE_CHANNEL,
      expect.anything(),
    );
  });
});
