import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { OfflineRoutePackService } from './offline-route-pack.service.js';

const driver: AuthenticatedUser = {
  id: 'user-1',
  establishment_id: 'est-1',
  courier_id: 'driver-1',
  role: UserRole.dispatcher,
  is_platform_admin: false,
};

function createService() {
  const prisma = { trip: { findFirst: jest.fn() } };
  return {
    prisma,
    service: new OfflineRoutePackService(prisma as unknown as PrismaService),
  };
}

describe('OfflineRoutePackService', () => {
  it('builds a provider-neutral corridor manifest for the assigned driver', async () => {
    const { prisma, service } = createService();
    prisma.trip.findFirst.mockResolvedValue({
      id: 'trip-1',
      updated_at: new Date('2026-10-02T08:00:00.000Z'),
      courier_id: 'driver-1',
      route: {
        id: 'route-1',
        stops: [
          { id: 'home', name: 'Home', sequence: 1, lat: -23.55, lng: -46.63 },
          {
            id: 'school',
            name: 'School',
            sequence: 2,
            lat: -23.56,
            lng: -46.64,
          },
        ],
      },
      passengers: [
        {
          passenger_id: 'passenger-1',
          pickup_stop: { id: 'home', name: 'Home', lat: -23.55, lng: -46.63 },
          dropoff_stop: {
            id: 'school',
            name: 'School',
            lat: -23.56,
            lng: -46.64,
          },
        },
      ],
    });

    const manifest = await service.getManifest('trip-1', driver);

    expect(manifest).toMatchObject({
      manifest_version: 1,
      trip_id: 'trip-1',
      route_id: 'route-1',
      margin_meters: 2000,
      passenger_ids: ['passenger-1'],
    });
    expect(manifest.stops).toHaveLength(2);
    expect(manifest.bounds).toEqual(
      expect.objectContaining({
        south: expect.any(Number),
        west: expect.any(Number),
        north: expect.any(Number),
        east: expect.any(Number),
      }),
    );
  });

  it('rejects a trip assigned to another driver', async () => {
    const { prisma, service } = createService();
    prisma.trip.findFirst.mockResolvedValue({
      id: 'trip-1',
      courier_id: 'driver-2',
      updated_at: new Date(),
      route: null,
      passengers: [],
    });

    await expect(service.getManifest('trip-1', driver)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('does not disclose a trip outside the driver tenant', async () => {
    const { prisma, service } = createService();
    prisma.trip.findFirst.mockResolvedValue(null);

    await expect(
      service.getManifest('foreign-trip', driver),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.trip.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'foreign-trip', establishment_id: 'est-1' },
      }),
    );
  });
});
