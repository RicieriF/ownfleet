import {
  CheckEventType,
  CheckValidationStatus,
  PassengerTripStatus,
  PassengerQrAction,
  Prisma,
  TripStatus,
  UserRole,
} from '@prisma/client';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { createHash } from 'node:crypto';
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

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

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
    passengerQrToken: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    passengerQrException: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    checkEvent: { findUnique: jest.fn() },
    tripPassenger: { findFirst: jest.fn() },
    authorizedPickup: { findFirst: jest.fn() },
    passengerQrToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    passengerQrException: { findMany: jest.fn().mockResolvedValue([]) },
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
        vehicle_id: 'vehicle-1',
        status: TripStatus.active,
      },
      passenger: {
        pickup_qr_required: false,
        handoff_qr_required: false,
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
      passenger: {
        pickup_qr_required: false,
        handoff_qr_required: false,
      },
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

describe('TransportService passenger QR enforcement', () => {
  const qrInput: RecordCheckEventInput = {
    ...input,
    event_uid: 'evt-qr',
    qr_token: 'short-lived-secret.nonce-value',
  };

  function prepareQr() {
    const mocks = createPrismaMock();
    mocks.prisma.checkEvent.findUnique.mockResolvedValue(null);
    mocks.prisma.tripPassenger.findFirst.mockResolvedValue({
      id: 'tp-1',
      trip_id: 'trip-1',
      passenger_id: 'passenger-1',
      status: PassengerTripStatus.waiting,
      trip: {
        courier_id: 'driver-1',
        vehicle_id: 'vehicle-1',
        status: TripStatus.active,
      },
      passenger: {
        pickup_qr_required: true,
        handoff_qr_required: false,
      },
    });
    mocks.prisma.passengerQrToken.findUnique.mockResolvedValue({
      id: 'qr-1',
      establishment_id: 'est-1',
      passenger_id: 'passenger-1',
      trip_id: 'trip-1',
      courier_id: 'driver-1',
      vehicle_id: 'vehicle-1',
      action: PassengerQrAction.board,
      token_hash: 'stored-hash',
      nonce_hash: sha256('nonce-value'),
      expires_at: new Date(Date.now() + 60_000),
      used_at: null,
      created_at: new Date(),
    });
    return mocks;
  }

  it('returns the prior event for an exact QR retry after token consumption', async () => {
    const { prisma } = createPrismaMock();
    prisma.checkEvent.findUnique.mockResolvedValue({
      ...existingEvent,
      event_uid: qrInput.event_uid,
      qr_nonce_hash: sha256('nonce-value'),
    });
    const service = new TransportService(prisma as unknown as PrismaService);

    await expect(
      service.recordCheckEvent(qrInput, user),
    ).resolves.toMatchObject({
      event_uid: qrInput.event_uid,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects event UID replay with a different QR nonce', async () => {
    const { prisma } = createPrismaMock();
    prisma.checkEvent.findUnique.mockResolvedValue({
      ...existingEvent,
      event_uid: qrInput.event_uid,
      qr_nonce_hash: sha256('nonce-value'),
    });
    const service = new TransportService(prisma as unknown as PrismaService);

    await expect(
      service.recordCheckEvent(
        { ...qrInput, qr_token: 'short-lived-secret.other-nonce' },
        user,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('consumes a valid token once and stores only its nonce hash', async () => {
    const { prisma, tx } = prepareQr();
    const service = new TransportService(prisma as unknown as PrismaService);

    await expect(service.recordCheckEvent(qrInput, user)).resolves.toEqual(
      existingEvent,
    );
    expect(tx.passengerQrToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'qr-1' }),
      }),
    );
    expect(tx.checkEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        qr_nonce_hash: sha256('nonce-value'),
      }),
    });
  });

  it('rejects an expired token', async () => {
    const { prisma } = prepareQr();
    prisma.passengerQrToken.findUnique.mockResolvedValue({
      ...(await prisma.passengerQrToken.findUnique()),
      expires_at: new Date(Date.now() - 1_000),
    });
    const service = new TransportService(prisma as unknown as PrismaService);

    await expect(service.recordCheckEvent(qrInput, user)).rejects.toThrow(
      'expired',
    );
  });

  it('rejects token replay', async () => {
    const { prisma } = prepareQr();
    prisma.passengerQrToken.findUnique.mockResolvedValue({
      ...(await prisma.passengerQrToken.findUnique()),
      used_at: new Date(),
    });
    const service = new TransportService(prisma as unknown as PrismaService);

    await expect(service.recordCheckEvent(qrInput, user)).rejects.toThrow(
      'already used',
    );
  });

  it.each([
    ['passenger_id', 'passenger-2'],
    ['trip_id', 'trip-2'],
    ['courier_id', 'driver-2'],
    ['vehicle_id', 'vehicle-2'],
    ['action', PassengerQrAction.guardian_handoff],
  ] as const)('rejects a token with wrong %s', async (field, value) => {
    const { prisma } = prepareQr();
    prisma.passengerQrToken.findUnique.mockResolvedValue({
      ...(await prisma.passengerQrToken.findUnique()),
      [field]: value,
    });
    const service = new TransportService(prisma as unknown as PrismaService);

    await expect(service.recordCheckEvent(qrInput, user)).rejects.toThrow(
      'context does not match',
    );
  });

  it('uses a bounded guardian exception without requiring a token', async () => {
    const { prisma, tx } = prepareQr();
    prisma.passengerQrException.findMany.mockResolvedValue([
      { id: 'exception-1', used_count: 0, max_uses: 1 },
    ]);
    const service = new TransportService(prisma as unknown as PrismaService);

    await service.recordCheckEvent({ ...qrInput, qr_token: undefined }, user);
    expect(tx.passengerQrException.updateMany).toHaveBeenCalledWith({
      where: { id: 'exception-1', used_count: 0 },
      data: { used_count: { increment: 1 } },
    });
    expect(prisma.passengerQrToken.findUnique).not.toHaveBeenCalled();
  });

  it('requires an explicit reason for driver override and audits it', async () => {
    const { prisma, tx } = prepareQr();
    const service = new TransportService(prisma as unknown as PrismaService);

    await service.recordCheckEvent(
      {
        ...qrInput,
        qr_token: undefined,
        override_reason: 'Guardian phone lost',
      },
      user,
    );
    expect(tx.checkEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          transport_verification: {
            mode: 'driver_override',
            reason: 'Guardian phone lost',
          },
        }),
      }),
    });
  });
});

describe('TransportService passenger QR issuance', () => {
  const operator: AuthenticatedUser = { ...user, courier_id: undefined };

  it('binds a short-lived token to the assigned trip context and stores hashes', async () => {
    const { prisma } = createPrismaMock();
    prisma.tripPassenger.findFirst.mockResolvedValue({
      id: 'tp-1',
      trip_id: 'trip-1',
      passenger_id: 'passenger-1',
      trip: {
        courier_id: 'driver-1',
        vehicle_id: 'vehicle-1',
        status: TripStatus.active,
      },
    });
    prisma.passengerQrToken.create.mockResolvedValue({ id: 'qr-1' });
    const service = new TransportService(prisma as unknown as PrismaService);

    const result = await service.issuePassengerQrToken(
      'tp-1',
      PassengerQrAction.board,
      60,
      operator,
    );

    expect(result.token.split('.')).toHaveLength(2);
    const [secret, nonce] = result.token.split('.');
    expect(prisma.passengerQrToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        establishment_id: 'est-1',
        passenger_id: 'passenger-1',
        trip_id: 'trip-1',
        courier_id: 'driver-1',
        vehicle_id: 'vehicle-1',
        action: PassengerQrAction.board,
        token_hash: sha256(secret),
        nonce_hash: sha256(nonce),
      }),
    });
    expect(
      JSON.stringify(prisma.passengerQrToken.create.mock.calls),
    ).not.toContain(result.token);
  });

  it('prevents a driver from minting passenger QR tokens', async () => {
    const { prisma } = createPrismaMock();
    const service = new TransportService(prisma as unknown as PrismaService);

    await expect(
      service.issuePassengerQrToken('tp-1', PassengerQrAction.board, 60, user),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.passengerQrToken.create).not.toHaveBeenCalled();
  });
});
