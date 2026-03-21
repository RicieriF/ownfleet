import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PlanAccessGuard } from '../establishments/guards/plan-access.guard.js';
import { OnboardingService } from './onboarding.service.js';
import { AuthenticatedUser } from '../auth/auth.types.js';
import { CreateInviteDto } from './dto/create-invite.dto.js';
import { AcceptInviteDto } from './dto/accept-invite.dto.js';

@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly service: OnboardingService) {}

  // ── Manager endpoints (JWT + plan required) ─────────────────────────────

  @Post('invites')
  @UseGuards(JwtAuthGuard, PlanAccessGuard)
  createInvite(@Body() dto: CreateInviteDto, @Req() req: any) {
    return this.service.createInvite(dto.courier_id, req.user as AuthenticatedUser);
  }

  @Get('invites')
  @UseGuards(JwtAuthGuard, PlanAccessGuard)
  listInvites(@Req() req: any) {
    return this.service.listInvites(req.user as AuthenticatedUser);
  }

  @Delete('invites/:id')
  @UseGuards(JwtAuthGuard, PlanAccessGuard)
  @HttpCode(HttpStatus.OK)
  revokeInvite(@Param('id') id: string, @Req() req: any) {
    return this.service.revokeInvite(id, req.user as AuthenticatedUser);
  }

  // ── Public endpoint — NO JWT, NO PlanAccessGuard ────────────────────────

  @Post('accept-invite/:token')
  @HttpCode(HttpStatus.OK)
  acceptInvite(@Param('token') token: string, @Body() dto: AcceptInviteDto) {
    return this.service.acceptInvite(token, dto.password);
  }
}
