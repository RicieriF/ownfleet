import {
  Controller,
  Post,
  Delete,
  Get,
  Patch,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PlanAccessGuard } from '../establishments/guards/plan-access.guard.js';
import { TelegramService } from './telegram.service.js';
import { UpdatePrefsDto } from './dto/update-prefs.dto.js';
import { CONNECT_CODE_TTL_SEC } from './telegram-redis.provider.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { TelegramUpdate } from './telegram.types.js';

@Controller('telegram')
export class TelegramController {
  constructor(private readonly service: TelegramService) {}

  /**
   * Telegram calls this endpoint for every incoming bot message.
   * No JWT — Telegram authenticates via X-Telegram-Bot-Api-Secret-Token header.
   * Always returns 200 OK (Telegram requires this to stop retries).
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @SkipThrottle() // Telegram servers — auth via X-Telegram-Bot-Api-Secret-Token; IP throttle would block retries
  async webhook(
    @Body() body: any,
    @Headers('x-telegram-bot-api-secret-token')
    secretHeader: string | undefined,
  ) {
    // Basic shape validation — reject clearly malformed payloads before processing
    if (!body || typeof body.update_id !== 'number') {
      throw new BadRequestException('Invalid Telegram update shape');
    }
    await this.service.handleWebhookUpdate(
      body as TelegramUpdate,
      secretHeader,
    );
    return { ok: true };
  }

  /** Generate a one-time connect code (TTL defined by CONNECT_CODE_TTL_SEC). */
  @Post('connect')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PlanAccessGuard)
  async connect(@CurrentUser() user: AuthenticatedUser) {
    const code = await this.service.generateConnectCode(
      user.id,
      user.courier_id ?? null,
    );
    return { code, expires_in: CONNECT_CODE_TTL_SEC };
  }

  /** Disconnect bot — removes chat_id and clears prefs. */
  @Delete('connect')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PlanAccessGuard)
  async disconnect(@CurrentUser() user: AuthenticatedUser) {
    await this.service.disconnect(
      user.id,
      user.courier_id ?? null,
      user.establishment_id,
    );
    return { disconnected: true };
  }

  /** Returns connection status and current prefs. */
  @Get('status')
  @UseGuards(JwtAuthGuard, PlanAccessGuard)
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getStatus(
      user.id,
      user.courier_id ?? null,
      user.establishment_id,
    );
  }

  /** Save notification preferences. */
  @Patch('prefs')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PlanAccessGuard)
  async updatePrefs(
    @Body() dto: UpdatePrefsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.updatePrefs(
      user.id,
      user.courier_id ?? null,
      user.establishment_id,
      dto,
    );
    return { ok: true };
  }
}
