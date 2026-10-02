import {
  CheckEventType,
  CheckValidationStatus,
  PassengerTripStatus,
  Prisma,
  TripStatus,
  UserRole,
} from '@prisma/client';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  RecordCheckEventInput,
  TransportService,
} from './transport.service.js';

const user: AuthenticatedUser = {
  id: 'user-1',
  establishment_id: 'est-1',
  role: UserRole.dispatcher,
  courier_id: 'driver-1',
  is_platform_admin: false,
};

const input: RecordCheckEventInput = {
  event_uid: 'evt-1',
  trip_id: 'trip-1',
  trip_passenger_id: 'tp-1',
  type: CheckEventType.board,
  validation_status: CheckValidationStatus.validated_online,
  captured_at: new Date('2026-10-02T08:00:00.000Z'),
  lat: -23.55,
  lng: -46.63,
  accuracy: 8,
};

const existingEvent = {
  id: 'check-1',
  establishment_id: 'est-1',
  event_uid: input.event_uid,
  trip_id: input.trip_id,
  trip_passenger_id: input.trip_passenger_id,
  passenger_id: 'passenger-1',
  courier_id: 'driver-1',
  guardian_id: null,
  type: input.type,
  validation_status: input.validation_status,
  captured_at: input.captured_at,
  received_at: new Date('2026-10-02T08:00:01.000Z'),
  lat: input.lat ?? null,
  lng: input.lng ?? null,
  accuracy: input.accuracy ?? null,
  qr_nonce_hash: null,
  metadata: {},
};

function createPrismaMock() {
  const tx = {
    checkEvent: { create: jest.fn().mockResolvedValue(existingEvent) },
    tripPassenger: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const prisma = {
    checkEvent: { findUnique: jest.fn() },
    tripPassenger: { findFirst: jest.fn() },
    authorizedPickup: { findFirst: jest.fn() },
    trip: {
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    ),
  };
  return { prisma, tx };
}

describe('TransportService check-event idempotency', () => {
  it('returns the existing event for an exact retry without a second transition', async () => {
    const { prisma, tx } = createPrismaMock();
    prisma.checkEvent.findUnique.mockResolvedValue(existingEvent);
    const service = new TransportService(prisma as unknown as PrismaService);

    await expect(service.recordCheckEvent(input, user)).resolves.toEqual(
      existingEvent,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.tripPassenger.updateMany).not.toHaveBeenCalled();
  });

  it('rejects reuse of an event UID with different event content', async () => {
    const { prisma } = createPrismaMock();
    prisma.checkEvent.findUnique.mockResolvedValue(existingEvent);
    const service = new TransportService(prisma as unknown as PrismaService);

    await expect(
      service.recordCheckEvent({ ...input, trip_passenger_id: 'tp-2' }, user),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not disclose an event UID owned by another tenant', async () => {
    const { prisma } = createPrismaMock();
    prisma.checkEvent.findUnique.mockResolvedValue({
      ...existingEvent,
      establishment_id: 'est-2',
    });
    const service = new TransportService(prisma as unknown as PrismaService);

    await expect(service.recordCheckEvent(input, user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('resolves a concurrent duplicate insert as the same idempotent event', async () => {
    const { prisma } = createPrismaMock();
    prisma.checkEvent.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingEvent);
    prisma.tripPassenger.findFirst.mockResolvedValue({
      id: 'tp-1',
      passenger_id: 'passenger-1',
      status: PassengerTripStatus.waiting,
      trip: {
        courier_id: 'driver-1',
        status: TripStatus.active,
      },
    });
    prisma.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '7.5.0',
      }),
    );
    const service = new TransportService(prisma as unknown as PrismaService);

    await expect(service.recordCheckEvent(input, user)).resolves.toEqual(
      existingEvent,
    );
  });
});

describe('TransportService guardian handoff authorization', () => {
  const handoffInput: RecordCheckEventInput = {
    ...input,
    event_uid: 'evt-handoff',
    type: CheckEventType.guardian_handoff,
    guardian_id: 'guardian-1',
  };

  function prepareHandoff() {
    const mocks = createPrismaMock();
    mocks.prisma.checkEvent.findUnique.mockResolvedValue(null);
    mocks.prisma.tripPassenger.findFirst.mockResolvedValue({
      id: 'tp-1',
      passenger_id: 'passenger-1',
      status: PassengerTripStatus.in_transit,
      trip: { courier_id: 'driver-1', status: TripStatus.active },
    });
    return mocks;
  }

  it('accepts a currently valid authorized pickup', async () => {
    const { prisma, tx } = prepareHandoff();
    prisma.authorizedPickup.findFirst.mockResolvedValue({ id: 'pickup-1' });
    const service = new TransportService(prisma as unknown as PrismaService);

    await expect(service.recordCheckEvent(handoffInput, user)).resolves.toEqual(
      existingEvent,
    );
    expect(prisma.authorizedPickup.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        establishment_id: 'est-1',
        passenger_id: 'passenger-1',
        guardian_id: 'guardian-1',
        active: true,
      }),
    });
    expect(tx.tripPassenger.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PassengerTripStatus.dropped_off,
        }),
      }),
    );
  });

  it.each(['expired', 'revoked'])(
    'rejects an %s authorized pickup',
    async () => {
      const { prisma } = prepareHandoff();
      prisma.authorizedPickup.findFirst.mockResolvedValue(null);
      const service = new TransportService(prisma as unknown as PrismaService);

      await expect(
        service.recordCheckEvent(handoffInput, user),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );
});

describe('TransportService school trip completion invariant', () => {
  it.each([PassengerTripStatus.boarded, PassengerTripStatus.in_transit])(
    'blocks completion with a %s passenger',
    async (status) => {
      const { prisma } = createPrismaMock();
      prisma.trip.findFirst.mockResolvedValue({
        id: 'trip-1',
        establishment_id: 'est-1',
        courier_id: 'driver-1',
        status: TripStatus.active,
        school_safety: true,
        passengers: [{ status }],
      });
      const service = new TransportService(prisma as unknown as PrismaService);

      await expect(service.completeTrip('trip-1', user)).rejects.toThrow(
        'cannot complete',
      );
      expect(prisma.trip.updateMany).not.toHaveBeenCalled();
    },
  );

  it('completes after every passenger has an explicit safe resolution', async () => {
    const { prisma } = createPrismaMock();
    prisma.trip.findFirst.mockResolvedValue({
      id: 'trip-1',
      establishment_id: 'est-1',
      courier_id: 'driver-1',
      status: TripStatus.active,
      school_safety: true,
      passengers: [
        { status: PassengerTripStatus.dropped_off },
        { status: PassengerTripStatus.absent },
      ],
    });
    const service = new TransportService(prisma as unknown as PrismaService);

    await expect(service.completeTrip('trip-1', user)).resolves.toMatchObject({
      id: 'trip-1',
      status: TripStatus.completed,
    });
    expect(prisma.trip.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ establishment_id: 'est-1' }),
      }),
    );
  });
});
