import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginDto } from './dto/login.dto.js';
import { JwtPayload, AuthenticatedUser } from './auth.types.js';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(dto: LoginDto): Promise<{
    accessToken: string;
    refreshToken: string;
    user: {
      id: string;
      establishment_id: string;
      role: string;
      name: string | null;
      email: string;
    };
  }> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: {
        establishment: {
          select: {
            id: true,
            plan: true,
            trial_ends_at: true,
            paid_until: true,
          },
        },
        courier: { select: { name: true, phone: true } },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatch = await bcrypt.compare(
      dto.password,
      user.password_hash,
    );
    if (!passwordMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: JwtPayload = {
      sub: user.id,
      establishment_id: user.establishment_id,
      role: user.role,
      is_platform_admin: user.is_platform_admin,
      ...(user.courier_id ? { courier_id: user.courier_id } : {}),
    };

    const accessToken = this.jwt.sign(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: ACCESS_TOKEN_TTL,
    });

    const refreshToken = await this.createRefreshToken(user.id);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        establishment_id: user.establishment_id,
        role: user.role,
        // For courier accounts, use courier name; for manager/owner, use email
        name: user.courier?.name ?? null,
        email: user.email,
      },
    };
  }

  async refresh(
    rawToken: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const tokenHash = this.hashToken(rawToken);

    // Atomic: delete-and-return in one operation prevents concurrent reuse
    const stored = await this.prisma.refreshToken
      .delete({ where: { token_hash: tokenHash }, include: { user: true } })
      .catch(() => null);

    if (!stored || stored.expires_at < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const payload: JwtPayload = {
      sub: stored.user.id,
      establishment_id: stored.user.establishment_id,
      role: stored.user.role,
      is_platform_admin: stored.user.is_platform_admin,
      ...(stored.user.courier_id ? { courier_id: stored.user.courier_id } : {}),
    };

    const accessToken = this.jwt.sign(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: ACCESS_TOKEN_TTL,
    });

    const refreshToken = await this.createRefreshToken(stored.user.id);

    return { accessToken, refreshToken };
  }

  /**
   * Issues a short-lived (60s) JWT for WebSocket authentication.
   * The web dashboard fetches this token via GET /auth/ws-token and passes
   * it in socket.io auth — the WS gateway validates it like a regular JWT.
   * Short expiry limits the XSS theft window to one minute.
   */
  issueWsToken(user: AuthenticatedUser): string {
    const payload: JwtPayload = {
      sub: user.id,
      establishment_id: user.establishment_id,
      role: user.role,
      is_platform_admin: user.is_platform_admin,
      ...(user.courier_id ? { courier_id: user.courier_id } : {}),
    };
    return this.jwt.sign(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: '60s',
    });
  }

  /**
   * Saves manager FCM push token for the authenticated user.
   * Uses upsert semantics: if another user has the same token (device swap),
   * clear it first to maintain the UNIQUE constraint.
   */
  async updateDeviceToken(
    userId: string,
    establishmentId: string,
    deviceToken: string,
    devicePlatform: string,
  ): Promise<void> {
    // Clear token from another user WITHIN THE SAME ESTABLISHMENT (device hand-off scenario).
    // Scoped to establishment_id to prevent cross-tenant token manipulation.
    await this.prisma.user.updateMany({
      where: {
        device_token: deviceToken,
        establishment_id: establishmentId,
        NOT: { id: userId },
      },
      data: { device_token: null, device_platform: null },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        device_token: deviceToken,
        device_platform:
          devicePlatform as import('@prisma/client').DevicePlatform,
      },
    });
  }

  async logout(rawToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    await this.prisma.refreshToken
      .delete({ where: { token_hash: tokenHash } })
      .catch(() => {
        // Token already gone — not an error
      });
  }

  private async createRefreshToken(userId: string): Promise<string> {
    const raw = crypto.randomBytes(64).toString('hex');
    const tokenHash = this.hashToken(raw);

    await this.prisma.refreshToken.create({
      data: {
        user_id: userId,
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });

    return raw;
  }

  private hashToken(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }
}
