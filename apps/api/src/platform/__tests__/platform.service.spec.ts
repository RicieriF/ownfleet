import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PlatformService } from '../platform.service.js';
import { PlatformAdminGuard } from '../guards/platform-admin.guard.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const mockPrisma = {
  establishment: {
    findMany: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  user: {
    findFirst: jest.fn(),
    createMany: jest.fn(),
  },
  $transaction: jest.fn(),
  $queryRaw: jest.fn().mockResolvedValue([]),
};

describe('PlatformService', () => {
  let service: PlatformService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<PlatformService>(PlatformService);
    jest.clearAllMocks();
  });

  // ── listEstablishments ────────────────────────────────────────────────────

  describe('listEstablishments', () => {
    const defaultQuery = { limit: 50, offset: 0 };

    it('returns paginated response with data, total, limit, offset', async () => {
      const now = new Date();
      const future = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
      mockPrisma.establishment.findMany.mockResolvedValue([
        {
          id: 'est-1',
          name: 'Test',
          slug: 'test',
          plan: 'starter',
          trial_ends_at: future,
          paid_until: null,
          onboarding_status: 'pending',
          created_at: now,
          _count: { couriers: 2, orders: 10 },
        },
      ]);
      mockPrisma.establishment.count.mockResolvedValue(1);

      const result = await service.listEstablishments(defaultQuery);
      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.limit).toBe(50);
      expect(result.offset).toBe(0);
      expect(result.data[0].access_status).toBe('trial');
      expect(result.data[0].couriers_count).toBe(2);
      expect(result.data[0].orders_total).toBe(10);
      expect(result.data[0].orders_last_30d).toBe(0); // no recent orders in mock
      expect(result.data[0].overdue_days).toBeNull();
    });

    it('orders_last_30d reflects recent activity from raw query', async () => {
      const now = new Date();
      mockPrisma.establishment.findMany.mockResolvedValue([
        {
          id: 'est-active',
          name: 'Active',
          slug: 'active',
          plan: 'starter',
          trial_ends_at: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000),
          paid_until: null,
          onboarding_status: 'completed',
          created_at: now,
          _count: { couriers: 1, orders: 50 },
        },
      ]);
      mockPrisma.establishment.count.mockResolvedValue(1);
      // Simulate 7 orders in the last 30 days for this establishment
      mockPrisma.$queryRaw.mockResolvedValue([
        { establishment_id: 'est-active', cnt: BigInt(7) },
      ]);

      const result = await service.listEstablishments(defaultQuery);
      expect(result.data[0].orders_total).toBe(50);
      expect(result.data[0].orders_last_30d).toBe(7);
    });

    it('marks expired establishments correctly', async () => {
      const past = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
      mockPrisma.establishment.findMany.mockResolvedValue([
        {
          id: 'est-2',
          name: 'Expired',
          slug: 'expired',
          plan: 'starter',
          trial_ends_at: past,
          paid_until: null,
          onboarding_status: 'completed',
          created_at: past,
          _count: { couriers: 1, orders: 5 },
        },
      ]);
      mockPrisma.establishment.count.mockResolvedValue(1);

      const result = await service.listEstablishments(defaultQuery);
      expect(result.data[0].access_status).toBe('expired');
      expect(result.data[0].overdue_days).toBeGreaterThan(0);
    });

    it('marks establishments in grace period (1–7 days after trial) correctly', async () => {
      const trialEndedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      mockPrisma.establishment.findMany.mockResolvedValue([
        {
          id: 'est-3',
          name: 'Grace',
          slug: 'grace',
          plan: 'starter',
          trial_ends_at: trialEndedAt,
          paid_until: null,
          onboarding_status: 'completed',
          created_at: trialEndedAt,
          _count: { couriers: 0, orders: 0 },
        },
      ]);
      mockPrisma.establishment.count.mockResolvedValue(1);

      const result = await service.listEstablishments(defaultQuery);
      expect(result.data[0].access_status).toBe('grace');
      expect(result.data[0].overdue_days).toBe(3);
    });

    it('shows active status for pilot plan regardless of dates', async () => {
      mockPrisma.establishment.findMany.mockResolvedValue([
        {
          id: 'est-4',
          name: 'Pilot Partner',
          slug: 'pilot-partner',
          plan: 'pilot',
          trial_ends_at: null,
          paid_until: null,
          onboarding_status: 'completed',
          created_at: new Date(),
          _count: { couriers: 0, orders: 0 },
        },
      ]);
      mockPrisma.establishment.count.mockResolvedValue(1);

      const result = await service.listEstablishments(defaultQuery);
      expect(result.data[0].access_status).toBe('active');
      expect(result.data[0].overdue_days).toBeNull();
    });
  });

  // ── createEstablishment ───────────────────────────────────────────────────

  describe('createEstablishment', () => {
    it('throws ConflictException on duplicate slug (P2002 from DB unique constraint)', async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        {
          code: 'P2002',
          clientVersion: '5.0.0',
        },
      );
      mockPrisma.$transaction.mockRejectedValue(p2002);

      await expect(
        service.createEstablishment({ name: 'Test', slug: 'test' }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException on P2002 race condition (concurrent create)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        {
          code: 'P2002',
          clientVersion: '5.0.0',
        },
      );
      mockPrisma.$transaction.mockRejectedValue(p2002);

      await expect(
        service.createEstablishment({ name: 'Race', slug: 'race' }),
      ).rejects.toThrow(ConflictException);
    });

    it('returns credentials with owner and manager emails on success', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(
        async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => {
          mockPrisma.establishment.create.mockResolvedValue({
            id: 'new-est',
            name: 'Pizza Place',
            slug: 'pizza-place',
            plan: 'starter',
            trial_ends_at: new Date(),
          });
          return fn(mockPrisma);
        },
      );

      const result = await service.createEstablishment({
        name: 'Pizza Place',
        slug: 'pizza-place',
      });

      expect(result.establishment.slug).toBe('pizza-place');
      expect(result.credentials.owner.email).toBe(
        'owner-pizza-place@ownfleet.app',
      );
      expect(result.credentials.manager.email).toBe(
        'manager-pizza-place@ownfleet.app',
      );
      expect(result.credentials.owner.password).toHaveLength(32); // 16 bytes hex
      expect(result.credentials.manager.password).toHaveLength(32);
    });

    it('passwords are different for owner and manager', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(
        async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => {
          mockPrisma.establishment.create.mockResolvedValue({
            id: 'new-est-2',
            name: 'Cafe',
            slug: 'cafe',
            plan: 'starter',
            trial_ends_at: new Date(),
          });
          return fn(mockPrisma);
        },
      );

      const result = await service.createEstablishment({
        name: 'Cafe',
        slug: 'cafe',
      });
      expect(result.credentials.owner.password).not.toBe(
        result.credentials.manager.password,
      );
    });
  });

  // ── extendSubscription ────────────────────────────────────────────────────

  describe('extendSubscription', () => {
    it('throws NotFoundException for unknown establishment', async () => {
      mockPrisma.establishment.findUnique.mockResolvedValue(null);
      await expect(
        service.extendSubscription('unknown-id', { days: 30 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('extends from today when subscription is expired — atomic SQL', async () => {
      // Existence check passes
      mockPrisma.establishment.findUnique.mockResolvedValue({ id: 'est-1' });
      // Simulate DB GREATEST(COALESCE(expired, NOW()), NOW()) + 30 days = ~now + 30 days
      const expectedPaidUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: 'est-1',
          name: 'Test',
          paid_until: expectedPaidUntil,
          trial_ends_at: null,
        },
      ]);

      const result = await service.extendSubscription('est-1', { days: 30 });

      // paid_until should be approx today + 30 days (not expired date + 30)
      const expectedMin = new Date(Date.now() + 29 * 24 * 60 * 60 * 1000);
      const expectedMax = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
      expect(result.paid_until!.getTime()).toBeGreaterThan(
        expectedMin.getTime(),
      );
      expect(result.paid_until!.getTime()).toBeLessThan(expectedMax.getTime());
    });

    it('extends from paid_until when subscription is still active — atomic SQL', async () => {
      const activeUntil = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      // Existence check passes
      mockPrisma.establishment.findUnique.mockResolvedValue({ id: 'est-2' });
      // Simulate DB GREATEST(activeUntil, NOW()) + 30 days = activeUntil + 30 days
      const expectedPaidUntil = new Date(
        activeUntil.getTime() + 30 * 24 * 60 * 60 * 1000,
      );
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: 'est-2',
          name: 'Active',
          paid_until: expectedPaidUntil,
          trial_ends_at: null,
        },
      ]);

      const result = await service.extendSubscription('est-2', { days: 30 });

      // paid_until should be approx activeUntil + 30 days
      const expected = new Date(
        activeUntil.getTime() + 30 * 24 * 60 * 60 * 1000,
      );
      expect(
        Math.abs(result.paid_until!.getTime() - expected.getTime()),
      ).toBeLessThan(1000);
    });
  });
});

// ── PlatformAdminGuard ────────────────────────────────────────────────────

describe('PlatformAdminGuard', () => {
  let guard: PlatformAdminGuard;
  const mockGuardPrisma = { user: { findUnique: jest.fn() } };

  beforeEach(() => {
    guard = new PlatformAdminGuard(mockGuardPrisma as any);
    jest.clearAllMocks();
  });

  function makeContext(user: object): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as unknown as ExecutionContext;
  }

  it('allows platform admin when JWT flag set and DB confirms', async () => {
    mockGuardPrisma.user.findUnique.mockResolvedValue({
      is_platform_admin: true,
    });
    const ctx = makeContext({ id: 'user-1', is_platform_admin: true });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('throws ForbiddenException immediately when JWT flag is false (no DB hit)', async () => {
    const ctx = makeContext({
      id: 'user-1',
      is_platform_admin: false,
      role: 'manager',
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    expect(mockGuardPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException when user is undefined (no DB hit)', async () => {
    const ctx = makeContext(undefined as unknown as object);
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    expect(mockGuardPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException when rights revoked in DB after token issued', async () => {
    // JWT says admin, but DB flag was revoked
    mockGuardPrisma.user.findUnique.mockResolvedValue({
      is_platform_admin: false,
    });
    const ctx = makeContext({ id: 'user-1', is_platform_admin: true });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });
});
