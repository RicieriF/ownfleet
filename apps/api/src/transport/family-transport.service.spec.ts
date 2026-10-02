import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  PassengerQrAction,
  PassengerTripStatus,
  DevicePlatform,
  TripStatus,
  UserRole,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import type IORedis from 'ioredis';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { FamilyTransportService } from './family-transport.service.js';

const operator: AuthenticatedUser = {
  id: 'operator-1',
  establishment_id: 'est-1',
  role: UserRole.manager,
  is_platform_admin: false,
};

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

function createMocks() {
  const prisma = {
    guardian: { findFirst: jest.fn(), update: jest.fn() },
    familyAccessToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    tripPassenger: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    passengerGuardian: { findFirst: jest.fn() },
    passengerQrException: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
  const redis = { get: jest.fn() };
  const service = new FamilyTransportService(
    prisma as unknown as PrismaService,
    redis as unknown as IORedis,
  );
  return { prisma, redis, service };
}

const activeAccess = {
  establishment_id: 'est-1',
  guardian_id: 'guardian-1',
  expires_at: new Date(Date.now() + 60_000),
  revoked_at: null,
  guardian: { active: true },
};

const assignment = {
  id: 'tp-1',
  status: PassengerTripStatus.waiting,
  scheduled_pickup_at: new Date('2026-10-02T12:00:00.000Z'),
  ready_at: null,
  boarded_at: null,
  dropped_off_at: null,
  passenger: {
    id: 'passenger-1',
    name: 'Child One',
    pickup_qr_required: true,
    handoff_qr_required: true,
  },
  pickup_stop: { id: 'pickup-1', name: 'Home' },
  dropoff_stop: { id: 'school-1', name: 'School' },
  trip: {
    id: 'trip-1',
    status: TripStatus.active,
    scheduled_at: new Date('2026-10-02T12:00:00.000Z'),
    eta_seconds: 600,
    distance_meters: 2400,
    courier_id: 'driver-1',
    courier: { id: 'driver-1', name: 'Driver', photo_url: null },
    vehicle: {
      id: 'vehicle-1',
      name: 'Van 1',
      plate: 'ABC1D23',
      model: 'Transit',
      color: 'White',
      photo_url: null,
    },
  },
  check_events: [],
};

describe('FamilyTransportService access lifecycle', () => {
  it('stores only the hash when an operator issues a family token', async () => {
    const { prisma, service } = createMocks();
    prisma.guardian.findFirst.mockResolvedValue({ id: 'guardian-1' });
    prisma.familyAccessToken.create.mockResolvedValue({ id: 'access-1' });

    const result = await service.issueAccessToken('guardian-1', 30, operator);

    expect(prisma.guardian.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'guardian-1',
        establishment_id: 'est-1',
        active: true,
      },
      select: { id: true },
    });
    expect(prisma.familyAccessToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        token_hash: sha256(result.token),
        establishment_id: 'est-1',
        guardian_id: 'guardian-1',
      }),
      select: { id: true },
    });
    expect(
      JSON.stringify(prisma.familyAccessToken.create.mock.calls),
    ).not.toContain(result.token);
  });

  it('scopes token revocation to the operator tenant', async () => {
    const { prisma, service } = createMocks();
    prisma.familyAccessToken.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.revokeAccessToken('access-other-tenant', operator),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.familyAccessToken.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'access-other-tenant',
        establishment_id: 'est-1',
        revoked_at: null,
      },
      data: { revoked_at: expect.any(Date) },
    });
  });
});

describe('FamilyTransportService protected home', () => {
  it.each([
    ['expired', { ...activeAccess, expires_at: new Date(0) }],
    ['revoked', { ...activeAccess, revoked_at: new Date() }],
    ['inactive guardian', { ...activeAccess, guardian: { active: false } }],
  ])('rejects an %s family credential', async (_label, access) => {
    const { prisma, service } = createMocks();
    prisma.familyAccessToken.findUnique.mockResolvedValue(access);

    await expect(
      service.getHome('tp-1', 'family-secret'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('does not expose a passenger unrelated to the authenticated guardian', async () => {
    const { prisma, service } = createMocks();
    prisma.familyAccessToken.findUnique.mockResolvedValue(activeAccess);
    prisma.tripPassenger.findFirst.mockResolvedValue(null);

    await expect(
      service.getHome('tp-1', 'family-secret'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.tripPassenger.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          establishment_id: 'est-1',
          passenger: {
            guardians: { some: { guardian_id: 'guardian-1' } },
          },
        }),
      }),
    );
  });

  it('returns identity, trip state and explicitly stale last-known position', async () => {
    const { prisma, redis, service } = createMocks();
    prisma.familyAccessToken.findUnique.mockResolvedValue(activeAccess);
    prisma.tripPassenger.findFirst.mockResolvedValue(assignment);
    redis.get.mockResolvedValue(
      JSON.stringify({
        lat: -23.55,
        lng: -46.63,
        ts: Date.now() - 45_000,
      }),
    );

    const home = await service.getHome('tp-1', 'family-secret');

    expect(home).toMatchObject({
      passenger_state: PassengerTripStatus.waiting,
      driver: { id: 'driver-1', name: 'Driver' },
      vehicle: { id: 'vehicle-1', plate: 'ABC1D23' },
      vehicle_position: {
        state: 'LAST_KNOWN',
        lat: -23.55,
        lng: -46.63,
      },
    });
  });

  it('marks readiness once and returns the original timestamp on retry', async () => {
    const { prisma, service } = createMocks();
    const readyAt = new Date('2026-10-02T11:55:00.000Z');
    prisma.familyAccessToken.findUnique.mockResolvedValue(activeAccess);
    prisma.tripPassenger.findFirst.mockResolvedValue({
      id: 'tp-1',
      ready_at: readyAt,
    });

    await expect(service.markReady('tp-1', 'family-secret')).resolves.toEqual({
      ready_at: readyAt,
    });
    expect(prisma.tripPassenger.updateMany).not.toHaveBeenCalled();
  });
});

describe('FamilyTransportService QR exceptions', () => {
  const exceptionInput = {
    action: PassengerQrAction.board,
    trip_id: 'trip-1',
    reason: 'Phone unavailable',
    valid_from: new Date(Date.now() + 60_000),
    valid_until: new Date(Date.now() + 3_600_000),
    max_uses: 1,
  };

  it('creates a bounded exception for a related passenger and trip', async () => {
    const { prisma, service } = createMocks();
    prisma.familyAccessToken.findUnique.mockResolvedValue(activeAccess);
    prisma.passengerGuardian.findFirst.mockResolvedValue({ id: 'relation-1' });
    prisma.tripPassenger.findFirst.mockResolvedValue({ id: 'tp-1' });
    prisma.passengerQrException.create.mockImplementation(({ data }) => data);

    await service.createQrException(
      'passenger-1',
      exceptionInput,
      'family-secret',
    );

    expect(prisma.passengerQrException.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        establishment_id: 'est-1',
        passenger_id: 'passenger-1',
        trip_id: 'trip-1',
        authorized_by_guardian_id: 'guardian-1',
        max_uses: 1,
      }),
    });
  });

  it('rejects an unrelated passenger without revealing tenant data', async () => {
    const { prisma, service } = createMocks();
    prisma.familyAccessToken.findUnique.mockResolvedValue(activeAccess);
    prisma.passengerGuardian.findFirst.mockResolvedValue(null);

    await expect(
      service.createQrException(
        'foreign-passenger',
        exceptionInput,
        'family-secret',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.passengerQrException.create).not.toHaveBeenCalled();
  });

  it('rejects expired or inverted exception windows', async () => {
    const { prisma, service } = createMocks();
    prisma.familyAccessToken.findUnique.mockResolvedValue(activeAccess);

    await expect(
      service.createQrException(
        'passenger-1',
        {
          ...exceptionInput,
          valid_from: new Date(Date.now() + 60_000),
          valid_until: new Date(Date.now() - 60_000),
        },
        'family-secret',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('revokes only an exception issued by the authenticated guardian', async () => {
    const { prisma, service } = createMocks();
    prisma.familyAccessToken.findUnique.mockResolvedValue(activeAccess);
    prisma.passengerQrException.findFirst.mockResolvedValue({
      id: 'exception-1',
      revoked_at: null,
    });
    prisma.passengerQrException.update.mockResolvedValue({
      id: 'exception-1',
      revoked_at: new Date(),
    });

    await service.revokeQrException('exception-1', 'family-secret');

    expect(prisma.passengerQrException.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'exception-1',
        establishment_id: 'est-1',
        authorized_by_guardian_id: 'guardian-1',
      },
    });
    expect(prisma.passengerQrException.update).toHaveBeenCalledTimes(1);
  });
});

describe('FamilyTransportService device registration', () => {
  it('registers a device only for the guardian resolved from the access token', async () => {
    const { prisma, service } = createMocks();
    prisma.familyAccessToken.findUnique.mockResolvedValue(activeAccess);
    prisma.guardian.update.mockResolvedValue({});

    await expect(
      service.registerDevice(
        'fcm-token-with-sufficient-length',
        DevicePlatform.android,
        'family-secret',
      ),
    ).resolves.toEqual({ registered: true });
    expect(prisma.guardian.update).toHaveBeenCalledWith({
      where: { id: 'guardian-1' },
      data: {
        device_token: 'fcm-token-with-sufficient-length',
        device_platform: DevicePlatform.android,
      },
    });
  });

  it('clears the authenticated guardian device without accepting a client ID', async () => {
    const { prisma, service } = createMocks();
    prisma.familyAccessToken.findUnique.mockResolvedValue(activeAccess);
    prisma.guardian.update.mockResolvedValue({});

    await expect(service.unregisterDevice('family-secret')).resolves.toEqual({
      registered: false,
    });
    expect(prisma.guardian.update).toHaveBeenCalledWith({
      where: { id: 'guardian-1' },
      data: { device_token: null, device_platform: null },
    });
  });
});
