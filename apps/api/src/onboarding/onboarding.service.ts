import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthenticatedUser } from '../auth/auth.types.js';
import { OnboardingStatus } from '@prisma/client';

const TOKEN_TTL_HOURS = 24;

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Manager: create invite ──────────────────────────────────────────────

  async createInvite(courierId: string, user: AuthenticatedUser) {
    const courier = await this.prisma.courier.findUnique({
      where: { id: courierId },
    });

    if (!courier || courier.establishment_id !== user.establishment_id) {
      throw new NotFoundException('Courier not found in your establishment');
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + TOKEN_TTL_HOURS);

    const invite = await this.prisma.inviteToken.create({
      data: {
        establishment_id: user.establishment_id,
        courier_id: courierId,
        token,
        expires_at: expiresAt,
      },
    });

    // Advance onboarding status to couriers_added if still pending
    await this.tryAdvanceOnboarding(user.establishment_id, OnboardingStatus.couriers_added);

    this.logger.log(`Invite created for courier ${courierId} by ${user.id}`);

    return {
      id: invite.id,
      token: invite.token,
      courier_id: courierId,
      expires_at: invite.expires_at,
    };
  }

  // ── Manager: list invites ───────────────────────────────────────────────

  async listInvites(user: AuthenticatedUser) {
    return this.prisma.inviteToken.findMany({
      where: { establishment_id: user.establishment_id },
      select: {
        id: true,
        courier_id: true,
        token: true,
        expires_at: true,
        used_at: true,
        created_at: true,
        courier: { select: { name: true } },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  // ── Manager: revoke invite ──────────────────────────────────────────────

  async revokeInvite(inviteId: string, user: AuthenticatedUser) {
    const invite = await this.prisma.inviteToken.findUnique({
      where: { id: inviteId },
    });

    if (!invite || invite.establishment_id !== user.establishment_id) {
      throw new NotFoundException('Invite not found');
    }

    if (invite.used_at) {
      throw new BadRequestException('Cannot revoke an already-used invite');
    }

    await this.prisma.inviteToken.delete({ where: { id: inviteId } });
    return { revoked: true };
  }

  // ── Courier (public): accept invite ────────────────────────────────────

  async acceptInvite(token: string) {
    const invite = await this.prisma.inviteToken.findUnique({
      where: { token },
      include: {
        establishment: { select: { id: true, name: true } },
        courier: { select: { id: true, name: true, phone: true } },
      },
    });

    if (!invite) {
      throw new NotFoundException('Invalid invite token');
    }

    if (invite.used_at) {
      throw new BadRequestException('Invite token has already been used');
    }

    if (invite.expires_at < new Date()) {
      throw new BadRequestException('Invite token has expired');
    }

    await this.prisma.inviteToken.update({
      where: { id: invite.id },
      data: { used_at: new Date() },
    });

    this.logger.log(`Invite accepted for courier ${invite.courier_id} (est: ${invite.establishment_id})`);

    return {
      courier_id: invite.courier_id,
      courier_name: invite.courier?.name ?? null,
      establishment_id: invite.establishment_id,
      establishment_name: invite.establishment.name,
    };
  }

  // ── Internal: onboarding status progression ─────────────────────────────

  private async tryAdvanceOnboarding(
    establishmentId: string,
    targetStatus: OnboardingStatus,
  ): Promise<void> {
    const STATUS_ORDER: OnboardingStatus[] = [
      OnboardingStatus.pending,
      OnboardingStatus.couriers_added,
      OnboardingStatus.first_order,
      OnboardingStatus.completed,
    ];

    const est = await this.prisma.establishment.findUnique({
      where: { id: establishmentId },
      select: { onboarding_status: true },
    });

    if (!est) return;

    const currentIdx = STATUS_ORDER.indexOf(est.onboarding_status);
    const targetIdx = STATUS_ORDER.indexOf(targetStatus);

    // Only advance forward — never go backwards
    if (targetIdx > currentIdx) {
      await this.prisma.establishment.update({
        where: { id: establishmentId },
        data: { onboarding_status: targetStatus },
      });
    }
  }
}
