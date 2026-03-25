import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthenticatedUser, JwtPayload } from '../auth/auth.types.js';
import { OnboardingStatus, TransportMode, UserRole } from '@prisma/client';

const TOKEN_TTL_HOURS = 24;

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

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

  async acceptInvite(token: string, password: string, transportMode?: TransportMode) {
    const now = new Date();

    // Atomic claim: only succeeds if token exists, unused, and not expired.
    const updated = await this.prisma.inviteToken.updateMany({
      where: { token, used_at: null, expires_at: { gt: now } },
      data: { used_at: now },
    });

    if (updated.count === 0) {
      const invite = await this.prisma.inviteToken.findUnique({ where: { token } });
      if (!invite) throw new NotFoundException('Invalid invite token');
      if (invite.used_at) throw new BadRequestException('Invite token has already been used');
      throw new BadRequestException('Invite token has expired');
    }

    const invite = await this.prisma.inviteToken.findUnique({
      where: { token },
      include: {
        establishment: { select: { id: true, name: true } },
        courier: { select: { id: true, name: true, phone: true } },
      },
    });

    // invite cannot be null — we just claimed it
    const courier = invite!.courier!;

    // Check if a user already exists for this courier (idempotent re-invite)
    const existingUser = await this.prisma.user.findUnique({
      where: { courier_id: courier.id },
    });
    if (existingUser) {
      throw new ConflictException('Courier account already exists. Please log in instead.');
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Use phone as email for courier accounts (phone is the login identifier)
    const email = courier.phone ?? `courier-${courier.id}@weego.internal`;

    const user = await this.prisma.user.create({
      data: {
        establishment_id: invite!.establishment_id,
        role: UserRole.dispatcher, // lowest-privilege role for couriers
        email,
        password_hash: passwordHash,
        courier_id: courier.id,
      },
    });

    this.logger.log(`Courier account created for courier ${courier.id} (est: ${invite!.establishment_id})`);

    // Persist transport mode if provided
    if (transportMode) {
      await this.prisma.courier.update({
        where: { id: courier.id },
        data: { transport_mode: transportMode },
      });
    }

    // Issue tokens so the courier is immediately logged in after accepting invite
    const payload: JwtPayload = {
      sub: user.id,
      establishment_id: user.establishment_id,
      role: user.role,
      is_platform_admin: false,
      courier_id: courier.id,
    };

    const ACCESS_TOKEN_TTL = '15m';
    const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

    const accessToken = this.jwt.sign(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: ACCESS_TOKEN_TTL,
    });

    const rawRefresh = crypto.randomBytes(64).toString('hex');
    const refreshHash = crypto.createHash('sha256').update(rawRefresh).digest('hex');
    await this.prisma.refreshToken.create({
      data: {
        user_id: user.id,
        token_hash: refreshHash,
        expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });

    return {
      access_token: accessToken,
      refresh_token: rawRefresh,
      user: {
        id: user.id,
        courier_id: courier.id,
        name: courier.name,
        establishment_id: user.establishment_id,
        establishment_name: invite!.establishment.name,
      },
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
