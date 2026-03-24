import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateEstablishmentDto } from './dto/create-establishment.dto.js';
import { ExtendSubscriptionDto } from './dto/extend-subscription.dto.js';
import { ListEstablishmentsDto } from './dto/list-establishments.dto.js';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

const BCRYPT_ROUNDS = 12;
const PASSWORD_BYTES = 16; // 16 random bytes → 32 hex chars — strong enough
const DEFAULT_TRIAL_DAYS = 14;

@Injectable()
export class PlatformService {
  constructor(private readonly prisma: PrismaService) {}

  // ── List all tenants ──────────────────────────────────────────────────────

  async listEstablishments(query: ListEstablishmentsDto) {
    const select = {
      id: true,
      name: true,
      slug: true,
      plan: true,
      trial_ends_at: true,
      paid_until: true,
      onboarding_status: true,
      created_at: true,
      _count: { select: { couriers: true, orders: true } },
    } as const;

    const [rows, total, recentCounts] = await Promise.all([
      this.prisma.establishment.findMany({
        orderBy: { created_at: 'desc' },
        select,
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.establishment.count(),
      // Single query for all per-establishment order counts in the last 30 days
      this.prisma.$queryRaw<{ establishment_id: string; cnt: bigint }[]>`
        SELECT establishment_id, COUNT(*) AS cnt
        FROM orders
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY establishment_id
      `,
    ]);

    const recentMap = new Map(
      recentCounts.map((r) => [r.establishment_id, Number(r.cnt)]),
    );

    const now = new Date();

    return {
      data: rows.map((est) => ({
        id: est.id,
        name: est.name,
        slug: est.slug,
        plan: est.plan,
        trial_ends_at: est.trial_ends_at,
        paid_until: est.paid_until,
        onboarding_status: est.onboarding_status,
        created_at: est.created_at,
        couriers_count: est._count.couriers,
        orders_total: est._count.orders,
        orders_last_30d: recentMap.get(est.id) ?? 0,
        access_status: this.computeAccessStatus(est.trial_ends_at, est.paid_until, now, est.plan),
        overdue_days: this.computeOverdueDays(est.trial_ends_at, est.paid_until, now),
      })),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  // ── Create new tenant ─────────────────────────────────────────────────────

  async createEstablishment(dto: CreateEstablishmentDto) {
    const ownerEmail   = `owner-${dto.slug}@weego.app`;
    const managerEmail = `manager-${dto.slug}@weego.app`;

    const ownerPassword   = crypto.randomBytes(PASSWORD_BYTES).toString('hex');
    const managerPassword = crypto.randomBytes(PASSWORD_BYTES).toString('hex');

    const [ownerHash, managerHash] = await Promise.all([
      bcrypt.hash(ownerPassword, BCRYPT_ROUNDS),
      bcrypt.hash(managerPassword, BCRYPT_ROUNDS),
    ]);

    const trialDays = dto.trial_days ?? DEFAULT_TRIAL_DAYS;
    const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);

    let establishment: { id: string; name: string; slug: string; plan: string; trial_ends_at: Date | null };
    try {
      establishment = await this.prisma.$transaction(async (tx) => {
        const est = await tx.establishment.create({
          data: {
            name: dto.name,
            slug: dto.slug,
            trial_ends_at: trialEndsAt,
          },
        });

        await tx.user.createMany({
          data: [
            {
              establishment_id: est.id,
              role: 'owner',
              email: ownerEmail,
              password_hash: ownerHash,
            },
            {
              establishment_id: est.id,
              role: 'manager',
              email: managerEmail,
              password_hash: managerHash,
            },
          ],
        });

        return est;
      });
    } catch (err) {
      // Handle concurrent creates with same slug — P2002 = unique constraint violation
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`Slug "${dto.slug}" is already taken`);
      }
      throw err;
    }

    // Plain-text passwords returned ONCE — never stored
    return {
      establishment: {
        id: establishment.id,
        name: establishment.name,
        slug: establishment.slug,
        plan: establishment.plan,
        trial_ends_at: establishment.trial_ends_at,
      },
      credentials: {
        owner:   { email: ownerEmail,   password: ownerPassword },
        manager: { email: managerEmail, password: managerPassword },
      },
    };
  }

  // ── Extend subscription ───────────────────────────────────────────────────

  async extendSubscription(establishmentId: string, dto: ExtendSubscriptionDto) {
    // Existence check before the atomic update
    const exists = await this.prisma.establishment.findUnique({
      where: { id: establishmentId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Establishment not found');

    // Atomic update: GREATEST(paid_until, NOW()) + N days prevents TOCTOU
    // between concurrent extension calls losing days.
    const intervalMs = dto.days * 24 * 60 * 60 * 1000;
    const results = await this.prisma.$queryRaw<
      { id: string; name: string; paid_until: Date | null; trial_ends_at: Date | null }[]
    >`
      UPDATE establishments
      SET paid_until = GREATEST(COALESCE(paid_until, NOW()), NOW()) + (${intervalMs} * INTERVAL '1 millisecond')
      WHERE id = ${establishmentId}::uuid
      RETURNING id, name, paid_until, trial_ends_at
    `;

    const updated = results[0];
    const now = new Date();

    return {
      id: updated.id,
      name: updated.name,
      paid_until: updated.paid_until,
      trial_ends_at: updated.trial_ends_at,
      access_status: this.computeAccessStatus(updated.trial_ends_at, updated.paid_until, now),
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private computeAccessStatus(
    trialEndsAt: Date | null,
    paidUntil: Date | null,
    now: Date,
    plan?: string,
  ): 'trial' | 'active' | 'grace' | 'expired' {
    // Pilot plan = permanent access, mirrors PlanAccessGuard
    if (plan === 'pilot') return 'active';
    if (paidUntil && paidUntil > now) return 'active';
    if (trialEndsAt && trialEndsAt > now) return 'trial';
    // 7-day grace period after trial (mirrors PlanAccessGuard logic)
    if (trialEndsAt) {
      const graceEnd = new Date(trialEndsAt.getTime() + 7 * 24 * 60 * 60 * 1000);
      if (graceEnd > now) return 'grace';
    }
    return 'expired';
  }

  private computeOverdueDays(
    trialEndsAt: Date | null,
    paidUntil: Date | null,
    now: Date,
  ): number | null {
    // Not overdue if active subscription
    if (paidUntil && paidUntil > now) return null;
    // Not overdue if trial still running
    if (trialEndsAt && trialEndsAt > now) return null;

    // Use the later of the two expiry dates as the baseline
    const expiredAt = paidUntil && trialEndsAt
      ? new Date(Math.max(paidUntil.getTime(), trialEndsAt.getTime()))
      : (paidUntil ?? trialEndsAt);

    if (!expiredAt) return null;
    return Math.floor((now.getTime() - expiredAt.getTime()) / (24 * 60 * 60 * 1000));
  }
}
