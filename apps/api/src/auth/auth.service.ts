import {
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginDto } from './dto/login.dto.js';
import { JwtPayload } from './auth.types.js';
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

  async login(dto: LoginDto): Promise<{ accessToken: string; refreshToken: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { establishment: { select: { id: true, plan: true, trial_ends_at: true, paid_until: true } } },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatch = await bcrypt.compare(dto.password, user.password_hash);
    if (!passwordMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: JwtPayload = {
      sub: user.id,
      establishment_id: user.establishment_id,
      role: user.role,
    };

    const accessToken = this.jwt.sign(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: ACCESS_TOKEN_TTL,
    });

    const refreshToken = await this.createRefreshToken(user.id);

    return { accessToken, refreshToken };
  }

  async refresh(rawToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const tokenHash = this.hashToken(rawToken);

    const stored = await this.prisma.refreshToken.findUnique({
      where: { token_hash: tokenHash },
      include: { user: true },
    });

    if (!stored || stored.expires_at < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Rotate: delete old, issue new
    await this.prisma.refreshToken.delete({ where: { id: stored.id } });

    const payload: JwtPayload = {
      sub: stored.user.id,
      establishment_id: stored.user.establishment_id,
      role: stored.user.role,
    };

    const accessToken = this.jwt.sign(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: ACCESS_TOKEN_TTL,
    });

    const refreshToken = await this.createRefreshToken(stored.user.id);

    return { accessToken, refreshToken };
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
