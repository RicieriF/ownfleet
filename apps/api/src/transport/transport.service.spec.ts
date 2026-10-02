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
