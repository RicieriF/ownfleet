import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { TransportService } from './transport.service.js';

const manager: AuthenticatedUser = {
  id: 'manager-1',
  establishment_id: 'est-1',
  role: UserRole.manager,
  is_platform_admin: false,
};

function mockPrisma() {
  return {
    passenger: { findFirst: jest.fn() },
    guardian: { findFirst: jest.fn() },
    authorizedPickup: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };
}

describe('TransportService authorized pickups', () => {
  it('creates a tenant-scoped temporary authorization', async () => {
    const prisma = mockPrisma();
    prisma.passenger.findFirst.mockResolvedValue({ id: 'passenger-1' });
    prisma.guardian.findFirst.mockResolvedValue({ id: 'guardian-1' });
    prisma.authorizedPickup.create.mockImplementation(({ data }) => data);
    const service = new TransportService(prisma as unknown as PrismaService);
    const from = new Date('2026-10-02T12:00:00.000Z');
    const until = new Date('2026-10-03T12:00:00.000Z');

    await service.createAuthorizedPickup(
      'passenger-1',
      'guardian-1',
      from,
      until,
      manager,
    );

    expect(prisma.passenger.findFirst).toHaveBeenCalledWith({
      where: { id: 'passenger-1', establishment_id: 'est-1', active: true },
      select: { id: true },
    });
    expect(prisma.guardian.findFirst).toHaveBeenCalledWith({
      where: { id: 'guardian-1', establishment_id: 'est-1', active: true },
      select: { id: true },
    });
    expect(prisma.authorizedPickup.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        establishment_id: 'est-1',
        passenger_id: 'passenger-1',
        guardian_id: 'guardian-1',
        valid_from: from,
        valid_until: until,
      }),
    });
  });

  it('rejects invalid validity windows', async () => {
    const service = new TransportService(
      mockPrisma() as unknown as PrismaService,
    );
    await expect(
      service.createAuthorizedPickup(
        'passenger-1',
        'guardian-1',
        new Date('2026-10-03T12:00:00.000Z'),
        new Date('2026-10-02T12:00:00.000Z'),
        manager,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not disclose cross-tenant passenger or guardian records', async () => {
    const prisma = mockPrisma();
    prisma.passenger.findFirst.mockResolvedValue(null);
    prisma.guardian.findFirst.mockResolvedValue({ id: 'guardian-1' });
    const service = new TransportService(prisma as unknown as PrismaService);

    await expect(
      service.createAuthorizedPickup(
        'foreign-passenger',
        'guardian-1',
        undefined,
        undefined,
        manager,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.authorizedPickup.create).not.toHaveBeenCalled();
  });

  it('revokes without deleting history and is idempotent', async () => {
    const prisma = mockPrisma();
    const authorization = { id: 'pickup-1', active: true };
    prisma.authorizedPickup.findFirst.mockResolvedValue(authorization);
    prisma.authorizedPickup.update.mockResolvedValue({
      ...authorization,
      active: false,
    });
    const service = new TransportService(prisma as unknown as PrismaService);

    await expect(
      service.revokeAuthorizedPickup('pickup-1', manager),
    ).resolves.toEqual({ id: 'pickup-1', active: false });
    expect(prisma.authorizedPickup.update).toHaveBeenCalledWith({
      where: { id: 'pickup-1' },
      data: { active: false },
    });

    prisma.authorizedPickup.findFirst.mockResolvedValue({
      ...authorization,
      active: false,
    });
    await service.revokeAuthorizedPickup('pickup-1', manager);
    expect(prisma.authorizedPickup.update).toHaveBeenCalledTimes(1);
  });

  it('prevents drivers from administering pickup authorizations', async () => {
    const service = new TransportService(
      mockPrisma() as unknown as PrismaService,
    );
    await expect(
      service.listAuthorizedPickups('passenger-1', {
        ...manager,
        courier_id: 'driver-1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
