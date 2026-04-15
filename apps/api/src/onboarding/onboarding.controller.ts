import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PlanAccessGuard } from '../establishments/guards/plan-access.guard.js';
import { OnboardingService } from './onboarding.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CreateInviteDto } from './dto/create-invite.dto.js';
import { AcceptInviteDto } from './dto/accept-invite.dto.js';

@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly service: OnboardingService) {}

  // ── Manager endpoints (JWT + plan required) ─────────────────────────────

  @Post('invites')
  @UseGuards(JwtAuthGuard, PlanAccessGuard)
  createInvite(
    @Body() dto: CreateInviteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createInvite(dto.courier_id, user);
  }

  @Get('invites')
  @UseGuards(JwtAuthGuard, PlanAccessGuard)
  listInvites(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listInvites(user);
  }

  @Delete('invites/:id')
  @UseGuards(JwtAuthGuard, PlanAccessGuard)
  @HttpCode(HttpStatus.OK)
  revokeInvite(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.revokeInvite(id, user);
  }

  // ── Public endpoint — NO JWT, NO PlanAccessGuard ────────────────────────

  @Post('accept-invite/:token')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 20 } }) // 20 attempts / min per IP
  acceptInvite(@Param('token') token: string, @Body() dto: AcceptInviteDto) {
    return this.service.acceptInvite(token, dto.password, dto.transport_mode);
  }
}
