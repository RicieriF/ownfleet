import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { AuthenticatedUser } from './auth.types.js';
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
  @Throttle({ default: { ttl: 60_000, limit: 30 } }) // 30 refreshes / min per IP
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

  /**
   * Issues a short-lived (60s) JWT for WebSocket authentication.
   * The web client calls this endpoint (cookie is forwarded automatically via
   * the Next.js rewrite proxy), then passes the returned token to socket.io auth.
   * Keeps the long-lived access_token out of JS entirely.
   */
  @Get('ws-token')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  wsToken(@Req() req: any): { token: string } {
    const user = req.user as AuthenticatedUser;
    return { token: this.authService.issueWsToken(user) };
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
