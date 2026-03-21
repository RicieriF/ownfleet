import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { TrackingService } from '../tracking.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../redis.provider.js';

const EST_A = 'est-a';
const EST_B = 'est-b';

const userA: any = { id: 'u1', establishment_id: EST_A, role: 'manager', is_platform_admin: false };

const courierA = { id: 'c1', establishment_id: EST_A };
const courierB = { id: 'c2', establishment_id: EST_B };

const mockPrisma = {
  courier: { findUnique: jest.fn() },
  $executeRaw: jest.fn().mockResolvedValue(1),
};

const mockRedis = {
  setex: jest.fn().mockResolvedValue('OK'),
  publish: jest.fn().mockResolvedValue(1),
  get: jest.fn(),
};

describe('TrackingService', () => {
  let service: TrackingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrackingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();
    service = module.get<TrackingService>(TrackingService);
    jest.clearAllMocks();
    mockPrisma.$executeRaw.mockResolvedValue(1);
    mockRedis.setex.mockResolvedValue('OK');
    mockRedis.publish.mockResolvedValue(1);
  });

  describe('handlePing', () => {
    const validPing = { courier_id: 'c1', lat: 50.45, lng: 30.52, battery: 80 };

    it('rejects ping for courier from another establishment', async () => {
      mockPrisma.courier.findUnique.mockResolvedValue(courierB);
      await expect(service.handlePing(validPing, userA)).rejects.toThrow(ForbiddenException);
    });

    it('rejects ping for non-existent courier', async () => {
      mockPrisma.courier.findUnique.mockResolvedValue(null);
      await expect(service.handlePing(validPing, userA)).rejects.toThrow(ForbiddenException);
    });

    it('stores ping in DB via PostGIS raw SQL', async () => {
      mockPrisma.courier.findUnique.mockResolvedValue(courierA);
      await service.handlePing(validPing, userA);
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('caches last position in Redis with TTL 300s', async () => {
      mockPrisma.courier.findUnique.mockResolvedValue(courierA);
      await service.handlePing(validPing, userA);
      expect(mockRedis.setex).toHaveBeenCalledWith(
        `courier:location:${validPing.courier_id}`,
        300,
        expect.stringContaining('"lat":50.45'),
      );
    });

    it('publishes courier_moved event to Redis pub/sub', async () => {
      mockPrisma.courier.findUnique.mockResolvedValue(courierA);
      await service.handlePing(validPing, userA);
      expect(mockRedis.publish).toHaveBeenCalledWith(
        'courier_moved',
        expect.stringContaining('"establishment_id":"est-a"'),
      );
    });
  });

  describe('getLastKnownPosition', () => {
    it('returns null when no cached position', async () => {
      mockPrisma.courier.findUnique.mockResolvedValue(courierA);
      mockRedis.get.mockResolvedValue(null);
      const result = await service.getLastKnownPosition('c1', EST_A);
      expect(result).toBeNull();
    });

    it('returns parsed position from Redis', async () => {
      mockPrisma.courier.findUnique.mockResolvedValue(courierA);
      mockRedis.get.mockResolvedValue(JSON.stringify({ lat: 50.45, lng: 30.52, battery: 80, ts: 1000 }));
      const result = await service.getLastKnownPosition('c1', EST_A);
      expect(result?.lat).toBe(50.45);
    });

    it('rejects access to courier from another establishment', async () => {
      mockPrisma.courier.findUnique.mockResolvedValue(courierB);
      await expect(service.getLastKnownPosition('c2', EST_A)).rejects.toThrow(ForbiddenException);
    });
  });
});
