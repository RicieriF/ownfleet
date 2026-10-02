import { ForbiddenException } from '@nestjs/common';
import { TripStatus, UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { DriverTripService } from './driver-trip.service.js';

const driver: AuthenticatedUser = {
  id: 'user-1',
  establishment_id: 'est-1',
  courier_id: 'driver-1',
  role: UserRole.dispatcher,
  is_platform_admin: false,
};

describe('DriverTripService', () => {
  it('returns only planned and active trips assigned within the tenant', async () => {
    const prisma = { trip: { findMany: jest.fn().mockResolvedValue([]) } };
    const service = new DriverTripService(prisma as unknown as PrismaService);

    await service.listAssigned(driver);

    expect(prisma.trip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          establishment_id: 'est-1',
          courier_id: 'driver-1',
          status: { in: [TripStatus.planned, TripStatus.active] },
        },
      }),
    );
  });

  it('rejects users without a driver identity', async () => {
    const prisma = { trip: { findMany: jest.fn() } };
    const service = new DriverTripService(prisma as unknown as PrismaService);

    await expect(
      service.listAssigned({ ...driver, courier_id: undefined }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.trip.findMany).not.toHaveBeenCalled();
  });
});
