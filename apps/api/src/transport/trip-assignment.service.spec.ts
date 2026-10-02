import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TripStatus, UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { TripAssignmentService } from './trip-assignment.service.js';

const operator: AuthenticatedUser = {
  id: 'manager-1',
  establishment_id: 'est-1',
  role: UserRole.manager,
  is_platform_admin: false,
};

function createMocks() {
  const tx = {
    trip: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    tripAssignmentChange: {
      create: jest.fn().mockResolvedValue({ id: 'change-1' }),
    },
  };
  const prisma = {
    trip: { findFirst: jest.fn() },
    courier: { findFirst: jest.fn() },
    vehicle: { findFirst: jest.fn() },
    passengerGuardian: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    ),
  };
  const notifications = {
    sendGuardianPush: jest.fn().mockResolvedValue(undefined),
  };
  const service = new TripAssignmentService(
    prisma as unknown as PrismaService,
    notifications as unknown as NotificationsService,
  );
  return { tx, prisma, notifications, service };
}

const activeTrip = {
  id: 'trip-1',
  status: TripStatus.active,
  courier_id: 'driver-old',
  vehicle_id: 'vehicle-old',
};

describe('TripAssignmentService', () => {
  it('atomically audits an active driver and vehicle reassignment', async () => {
    const { tx, prisma, notifications, service } = createMocks();
    prisma.trip.findFirst.mockResolvedValue(activeTrip);
    prisma.courier.findFirst.mockResolvedValue({
      id: 'driver-new',
      name: 'New Driver',
    });
    prisma.vehicle.findFirst.mockResolvedValue({
      id: 'vehicle-new',
      plate: 'NEW1A23',
    });
    prisma.passengerGuardian.findMany.mockResolvedValue([
      { guardian_id: 'guardian-1' },
    ]);

    await service.reassign(
      'trip-1',
      {
        courier_id: 'driver-new',
        vehicle_id: 'vehicle-new',
        reason: 'Driver unavailable',
      },
      operator,
    );

    expect(tx.trip.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'trip-1',
        establishment_id: 'est-1',
        courier_id: 'driver-old',
        vehicle_id: 'vehicle-old',
        status: TripStatus.active,
      },
      data: { courier_id: 'driver-new', vehicle_id: 'vehicle-new' },
    });
    expect(tx.tripAssignmentChange.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        establishment_id: 'est-1',
        changed_by_user_id: 'manager-1',
        old_courier_id: 'driver-old',
        new_courier_id: 'driver-new',
        old_vehicle_id: 'vehicle-old',
        new_vehicle_id: 'vehicle-new',
        reason: 'Driver unavailable',
      }),
    });
    expect(notifications.sendGuardianPush).toHaveBeenCalledWith(
      'guardian-1',
      expect.objectContaining({
        data: {
          trip_id: 'trip-1',
          assignment_change_id: 'change-1',
        },
      }),
    );
  });

  it('rejects a driver attempting to reassign their own trip', async () => {
    const { service } = createMocks();
    await expect(
      service.reassign(
        'trip-1',
        { courier_id: 'driver-new', reason: 'self change' },
        { ...operator, courier_id: 'driver-old' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a target driver outside the tenant', async () => {
    const { prisma, service } = createMocks();
    prisma.trip.findFirst.mockResolvedValue(activeTrip);
    prisma.courier.findFirst.mockResolvedValue(null);
    prisma.vehicle.findFirst.mockResolvedValue({ id: 'vehicle-old' });

    await expect(
      service.reassign(
        'trip-1',
        { courier_id: 'driver-other-tenant', reason: 'replacement' },
        operator,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.courier.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'driver-other-tenant',
        establishment_id: 'est-1',
        active: true,
      },
      select: { id: true, name: true },
    });
  });

  it('rolls back the audit path when assignment changed concurrently', async () => {
    const { tx, prisma, notifications, service } = createMocks();
    prisma.trip.findFirst.mockResolvedValue(activeTrip);
    prisma.courier.findFirst.mockResolvedValue({
      id: 'driver-new',
      name: 'New Driver',
    });
    prisma.vehicle.findFirst.mockResolvedValue({
      id: 'vehicle-old',
      plate: 'OLD1A23',
    });
    tx.trip.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.reassign(
        'trip-1',
        { courier_id: 'driver-new', reason: 'replacement' },
        operator,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.tripAssignmentChange.create).not.toHaveBeenCalled();
    expect(notifications.sendGuardianPush).not.toHaveBeenCalled();
  });
});
