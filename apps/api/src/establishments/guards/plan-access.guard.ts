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

@Injectable()
export class PlanAccessGuard implements CanActivate {
  private readonly logger = new Logger(PlanAccessGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ user: AuthenticatedUser }>();
    const user = req.user;

    // Platform admins bypass billing checks
    if (user.is_platform_admin) return true;

    const est = await this.prisma.establishment.findUniqueOrThrow({
      where: { id: user.establishment_id },
      select: { plan: true, trial_ends_at: true, paid_until: true },
    });

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

    throw new HttpException({ code: 'PLAN_EXPIRED' }, HttpStatus.PAYMENT_REQUIRED);
  }
}
