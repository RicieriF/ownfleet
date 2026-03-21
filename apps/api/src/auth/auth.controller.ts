import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';

const REFRESH_COOKIE = 'refresh_token';
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env['NODE_ENV'] === 'production',
  sameSite: 'strict' as const,
  maxAge: 30 * 24 * 60 * 60 * 1000,
  path: '/api/v1/auth',
};

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: any,
  ): Promise<{ accessToken: string }> {
    const { accessToken, refreshToken } = await this.authService.login(dto);
    res.cookie(REFRESH_COOKIE, refreshToken, COOKIE_OPTS);
    return { accessToken };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ): Promise<{ accessToken: string }> {
    const raw: string | undefined = req.cookies?.[REFRESH_COOKIE];
    if (!raw) {
      res.status(HttpStatus.UNAUTHORIZED).json({ message: 'No refresh token' });
      return { accessToken: '' };
    }
    const { accessToken, refreshToken } = await this.authService.refresh(raw);
    res.cookie(REFRESH_COOKIE, refreshToken, COOKIE_OPTS);
    return { accessToken };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
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
