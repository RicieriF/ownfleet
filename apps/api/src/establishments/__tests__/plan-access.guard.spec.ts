import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, ExecutionContext } from '@nestjs/common';
import { PlanAccessGuard } from '../guards/plan-access.guard.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const DAY = 24 * 60 * 60 * 1000;

function makeCtx(establishmentId = 'est-1'): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: 'u1', establishment_id: establishmentId, role: 'manager' } }),
    }),
  } as unknown as ExecutionContext;
}

const mockPrisma = { establishment: { findUniqueOrThrow: jest.fn() } };

describe('PlanAccessGuard', () => {
  let guard: PlanAccessGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanAccessGuard,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    guard = module.get<PlanAccessGuard>(PlanAccessGuard);
    jest.clearAllMocks();
  });

  it('allows pilot plan unconditionally', async () => {
    mockPrisma.establishment.findUniqueOrThrow.mockResolvedValue({
      plan: 'pilot', trial_ends_at: null, paid_until: null,
    });
    await expect(guard.canActivate(makeCtx())).resolves.toBe(true);
  });

  it('allows active paid subscription', async () => {
    mockPrisma.establishment.findUniqueOrThrow.mockResolvedValue({
      plan: 'starter',
      paid_until: new Date(Date.now() + DAY),
      trial_ends_at: null,
    });
    await expect(guard.canActivate(makeCtx())).resolves.toBe(true);
  });

  it('allows active trial', async () => {
    mockPrisma.establishment.findUniqueOrThrow.mockResolvedValue({
      plan: 'starter',
      paid_until: null,
      trial_ends_at: new Date(Date.now() + DAY),
    });
    await expect(guard.canActivate(makeCtx())).resolves.toBe(true);
  });

  it('allows within 7-day grace period after trial', async () => {
    mockPrisma.establishment.findUniqueOrThrow.mockResolvedValue({
      plan: 'starter',
      paid_until: null,
      trial_ends_at: new Date(Date.now() - 3 * DAY), // expired 3 days ago
    });
    await expect(guard.canActivate(makeCtx())).resolves.toBe(true);
  });

  it('blocks after grace period expires', async () => {
    mockPrisma.establishment.findUniqueOrThrow.mockResolvedValue({
      plan: 'starter',
      paid_until: null,
      trial_ends_at: new Date(Date.now() - 8 * DAY), // expired 8 days ago
    });
    await expect(guard.canActivate(makeCtx())).rejects.toThrow(HttpException);
  });

  it('blocks with no trial and no payment', async () => {
    mockPrisma.establishment.findUniqueOrThrow.mockResolvedValue({
      plan: 'starter',
      paid_until: null,
      trial_ends_at: null,
    });
    await expect(guard.canActivate(makeCtx())).rejects.toThrow(HttpException);
  });

  it('returns 402 PAYMENT_REQUIRED on block', async () => {
    mockPrisma.establishment.findUniqueOrThrow.mockResolvedValue({
      plan: 'starter',
      paid_until: null,
      trial_ends_at: new Date(Date.now() - 8 * DAY),
    });
    try {
      await guard.canActivate(makeCtx());
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(402);
      expect((e as HttpException).getResponse()).toMatchObject({ code: 'PLAN_EXPIRED' });
    }
  });
});
