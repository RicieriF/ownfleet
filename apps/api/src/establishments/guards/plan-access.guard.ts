import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuthenticatedUser } from '../../auth/auth.types.js';

const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CACHE_TTL_MS = 30_000; // 30 seconds — acceptable lag for plan changes

interface CachedEntry {
  plan: string;
  trial_ends_at: Date | null;
  paid_until: Date | null;
  expiresAt: number;
}

@Injectable()
export class PlanAccessGuard implements CanActivate {
  private readonly logger = new Logger(PlanAccessGuard.name);
  private readonly cache = new Map<string, CachedEntry>();

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ user: AuthenticatedUser }>();
    const user = req.user;

    // Platform admins bypass billing checks
    if (user.is_platform_admin) return true;

    let est = this.getCached(user.establishment_id);
    if (!est) {
      est = await this.prisma.establishment.findUniqueOrThrow({
        where: { id: user.establishment_id },
        select: { plan: true, trial_ends_at: true, paid_until: true },
      });
      this.cache.set(user.establishment_id, {
        ...est,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
    }

    // Pilot plan — always allowed
    if (est.plan === 'pilot') return true;

    const now = new Date();

    // Active paid subscription
    if (est.paid_until && est.paid_until > now) return true;

    // Active trial
    if (est.trial_ends_at && est.trial_ends_at > now) return true;

    // Grace period: 7 days after trial expiry
    if (est.trial_ends_at) {
      const graceEnd = new Date(est.trial_ends_at.getTime() + GRACE_PERIOD_MS);
      if (graceEnd > now) return true;
    }

    throw new HttpException({ code: 'PLAN_EXPIRED', message: 'Термін дії тарифного плану закінчився' }, HttpStatus.PAYMENT_REQUIRED);
  }

  private getCached(establishmentId: string): Pick<CachedEntry, 'plan' | 'trial_ends_at' | 'paid_until'> | null {
    const entry = this.cache.get(establishmentId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(establishmentId);
      return null;
    }
    return entry;
  }
}
