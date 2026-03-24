import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bull';
import { TrackingService, PING_PERSIST_QUEUE } from '../tracking.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../redis.provider.js';

const EST_A = 'est-a';
const EST_B = 'est-b';

// Courier-linked user (has courier_id in JWT)
const courierUser: any = { id: 'u1', establishment_id: EST_A, role: 'manager', is_platform_admin: false, courier_id: 'c1' };
// Manager user (no courier_id)
const managerUser: any = { id: 'u2', establishment_id: EST_A, role: 'manager', is_platform_admin: false };

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

const mockPingQueue = {
  add: jest.fn().mockResolvedValue({}),
};

describe('TrackingService', () => {
  let service: TrackingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrackingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: getQueueToken(PING_PERSIST_QUEUE), useValue: mockPingQueue },
      ],
    }).compile();
    service = module.get<TrackingService>(TrackingService);
    jest.clearAllMocks();
    mockPrisma.$executeRaw.mockResolvedValue(1);
    mockRedis.setex.mockResolvedValue('OK');
    mockRedis.publish.mockResolvedValue(1);
    mockPingQueue.add.mockResolvedValue({});
  });

  describe('handlePing', () => {
    const validPing = { lat: 50.45, lng: 30.52, battery: 80 };

    it('rejects ping from non-courier (manager) account', async () => {
      await expect(service.handlePing(validPing, managerUser)).rejects.toThrow(ForbiddenException);
    });

    it('enqueues ping for async DB persist via Bull', async () => {
      await service.handlePing(validPing, courierUser);
      expect(mockPingQueue.add).toHaveBeenCalledWith(
        { courier_id: courierUser.courier_id, lat: 50.45, lng: 30.52, battery: 80 },
        expect.objectContaining({ removeOnComplete: 100, removeOnFail: 50 }),
      );
      // DB write is NOT called synchronously — it happens in the processor
      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('caches last position in Redis with TTL 300s', async () => {
      await service.handlePing(validPing, courierUser);
      expect(mockRedis.setex).toHaveBeenCalledWith(
        `courier:location:${courierUser.courier_id}`,
        300,
        expect.stringContaining('"lat":50.45'),
      );
    });

    it('publishes courier_moved event to Redis pub/sub', async () => {
      await service.handlePing(validPing, courierUser);
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
