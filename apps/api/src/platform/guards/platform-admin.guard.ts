import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { AuthenticatedUser } from '../../auth/auth.types.js';
import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  private readonly logger = new Logger(PlatformAdminGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ user: AuthenticatedUser }>();

    // Fast-reject: JWT flag not set (avoids unnecessary DB hit)
    if (!req.user?.is_platform_admin) {
      throw new ForbiddenException('Platform admin access required');
    }

    // DB validation: verify the flag wasn't revoked since the token was issued
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.id },
      select: { is_platform_admin: true },
    });

    if (!user?.is_platform_admin) {
      // Log privilege escalation attempt — token still valid but rights revoked
      this.logger.warn(
        `Revoked platform admin access attempt — user=${req.user.id}`,
      );
      throw new ForbiddenException('Platform admin access required');
    }

    return true;
  }
}
