import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PlanAccessGuard } from './guards/plan-access.guard.js';
import { EstablishmentsService } from './establishments.service.js';
import { UpdateSettingsDto } from './dto/update-settings.dto.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';

@Controller('establishments')
@UseGuards(JwtAuthGuard)
export class EstablishmentsController {
  constructor(private readonly service: EstablishmentsService) {}

  @Get('me')
  @UseGuards(PlanAccessGuard)
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.service.findOne(user);
  }

  @Get('me/settings')
  @UseGuards(PlanAccessGuard)
  getSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getSettings(user);
  }

  @Patch('me/settings')
  @UseGuards(PlanAccessGuard)
  updateSettings(
    @Body() dto: UpdateSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateSettings(user, dto);
  }
}
