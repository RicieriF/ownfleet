import { Test, TestingModule } from '@nestjs/testing';
import { GeocodingProcessor, GEOCODING_DONE_CHANNEL } from '../processors/geocoding.processor.js';
import { GeocodingService } from '../geocoding.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../shared/redis/redis.constants.js';
import type { Job } from 'bull';
import type { GeocodeJob } from '../geocoding.service.js';

const mockGeocodingService = { geocode: jest.fn() };
const mockOrder = { update: jest.fn() };
const mockPrisma = { order: mockOrder };
const mockRedis = { publish: jest.fn() };

const makeJob = (data: GeocodeJob): Job<GeocodeJob> =>
  ({ data } as Job<GeocodeJob>);

describe('GeocodingProcessor', () => {
  let processor: GeocodingProcessor;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeocodingProcessor,
        { provide: GeocodingService, useValue: mockGeocodingService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    processor = module.get<GeocodingProcessor>(GeocodingProcessor);
    jest.clearAllMocks();
  });

  // ── Success path ──────────────────────────────────────────────────────────

  it('updates order with coords and publishes geocoding:done on success', async () => {
    mockGeocodingService.geocode.mockResolvedValue({ lat: 50.45, lng: 30.52 });
    mockOrder.update.mockResolvedValue({});
    mockRedis.publish.mockResolvedValue(1);

    await processor.handle(makeJob({ orderId: 'order-1', address: 'вул. Тестова 5' }));

    expect(mockOrder.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { lat: 50.45, lng: 30.52 },
    });
    expect(mockRedis.publish).toHaveBeenCalledWith(
      GEOCODING_DONE_CHANNEL,
      JSON.stringify({ orderId: 'order-1', lat: 50.45, lng: 30.52 }),
    );
  });

  // ── Failure path ──────────────────────────────────────────────────────────

  it('does not update order or publish when geocode returns null (timeout)', async () => {
    mockGeocodingService.geocode.mockResolvedValue(null);

    await processor.handle(makeJob({ orderId: 'order-2', address: 'вул. Повільна 1' }));

    expect(mockOrder.update).not.toHaveBeenCalled();
    expect(mockRedis.publish).not.toHaveBeenCalled();
  });

  it('does not publish geocoding:done when DB update throws', async () => {
    mockGeocodingService.geocode.mockResolvedValue({ lat: 50.45, lng: 30.52 });
    mockOrder.update.mockRejectedValue(new Error('DB error'));

    await expect(
      processor.handle(makeJob({ orderId: 'order-3', address: 'вул. Тестова 5' })),
    ).rejects.toThrow('DB error');

    expect(mockRedis.publish).not.toHaveBeenCalled();
  });
});
