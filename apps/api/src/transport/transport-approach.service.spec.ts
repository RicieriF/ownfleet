import { PassengerTripStatus, TripStatus } from '@prisma/client';
import type IORedis from 'ioredis';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { TransportApproachService } from './transport-approach.service.js';

function createMocks() {
  const prisma = { tripPassenger: { findMany: jest.fn() } };
  const redis = { set: jest.fn().mockResolvedValue('OK') };
  const notifications = {
    sendGuardianPush: jest.fn().mockResolvedValue(undefined),
  };
  const service = new TransportApproachService(
    prisma as unknown as PrismaService,
    redis as unknown as IORedis,
    notifications as unknown as NotificationsService,
  );
  return { prisma, redis, notifications, service };
}

const assignment = {
  id: 'tp-1',
  trip_id: 'trip-1',
  passenger: {
    name: 'Ana',
    guardians: [{ guardian_id: 'guardian-1' }],
  },
  pickup_stop: { lat: -23.55, lng: -46.63, geofence_meters: 300 },
};

describe('TransportApproachService', () => {
  it('sends one deduplicated approach notification inside the radius', async () => {
    const { prisma, redis, notifications, service } = createMocks();
    prisma.tripPassenger.findMany.mockResolvedValue([assignment]);

    await service.handlePosition('driver-1', 'est-1', -23.5505, -46.6305);

    expect(prisma.tripPassenger.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          establishment_id: 'est-1',
          status: PassengerTripStatus.waiting,
          trip: { courier_id: 'driver-1', status: TripStatus.active },
        }),
      }),
    );
    expect(redis.set).toHaveBeenCalledWith(
      'transport:approach:trip-1:tp-1',
      '1',
      'EX',
      43_200,
      'NX',
    );
    expect(notifications.sendGuardianPush).toHaveBeenCalledWith(
      'guardian-1',
      expect.objectContaining({ title: 'Van chegando' }),
    );
  });

  it('does not notify again when the deduplication key already exists', async () => {
    const { prisma, redis, notifications, service } = createMocks();
    prisma.tripPassenger.findMany.mockResolvedValue([assignment]);
    redis.set.mockResolvedValue(null);

    await service.handlePosition('driver-1', 'est-1', -23.5505, -46.6305);

    expect(notifications.sendGuardianPush).not.toHaveBeenCalled();
  });

  it('does not notify while the vehicle is outside the approach radius', async () => {
    const { prisma, redis, notifications, service } = createMocks();
    prisma.tripPassenger.findMany.mockResolvedValue([assignment]);

    await service.handlePosition('driver-1', 'est-1', -23.6, -46.7);

    expect(redis.set).not.toHaveBeenCalled();
    expect(notifications.sendGuardianPush).not.toHaveBeenCalled();
  });
});
