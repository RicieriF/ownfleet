import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';
import { AuthenticatedUser } from '../../auth/auth.types.js';

/**
 * Extends ThrottlerGuard to key rate limits on user ID for authenticated
 * requests instead of IP address.
 *
 * This prevents CGNAT / shared-NAT scenarios (e.g. multiple couriers from
 * the same restaurant on the same mobile carrier) from exhausting each
 * other's quota.
 *
 * Unauthenticated endpoints (login, onboarding invite) fall back to IP —
 * correct behaviour since they have no user identity yet.
 */
@Injectable()
export class UserAwareThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Request): Promise<string> {
    const user = (req as Request & { user?: AuthenticatedUser }).user;
    return user?.id ?? req.ip ?? 'anonymous';
  }
}
