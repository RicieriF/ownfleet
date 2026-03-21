import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';

const REFRESH_COOKIE = 'refresh_token';
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env['NODE_ENV'] === 'production',
  sameSite: 'strict' as const,
  maxAge: 30 * 24 * 60 * 60 * 1000,
  path: '/api/v1/auth', // must match the full prefixed path for cookie scope
};

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } }) // 10 attempts / min per IP
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: any,
  ): Promise<{ access_token: string; refresh_token: string; user: object }> {
    const { accessToken, refreshToken, user } = await this.authService.login(dto);
    // HttpOnly cookie for web clients; body for mobile (React Native can't read cookies)
    res.cookie(REFRESH_COOKIE, refreshToken, COOKIE_OPTS);
    return { access_token: accessToken, refresh_token: refreshToken, user };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ): Promise<{ access_token: string; refresh_token: string }> {
    // Accept refresh token from HttpOnly cookie (web) or Authorization-like header (mobile)
    const raw: string | undefined =
      req.cookies?.[REFRESH_COOKIE] ?? req.headers?.['x-refresh-token'];
    if (!raw) {
      throw new UnauthorizedException('No refresh token');
    }
    const { accessToken, refreshToken } = await this.authService.refresh(raw);
    res.cookie(REFRESH_COOKIE, refreshToken, COOKIE_OPTS);
    return { access_token: accessToken, refresh_token: refreshToken };
  }

  // logout does NOT require JwtAuthGuard — access token may be expired
  // but refresh token is still valid. We only need the refresh cookie.
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ): Promise<void> {
    const raw: string | undefined = req.cookies?.[REFRESH_COOKIE];
    if (raw) {
      await this.authService.logout(raw);
    }
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  }
}
