import {
  Body,
  Controller,
  Get,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PlanAccessGuard } from './guards/plan-access.guard.js';
import { EstablishmentsService } from './establishments.service.js';
import { UpdateSettingsDto } from './dto/update-settings.dto.js';
import { AuthenticatedUser } from '../auth/auth.types.js';

@Controller('establishments')
@UseGuards(JwtAuthGuard)
export class EstablishmentsController {
  constructor(private readonly service: EstablishmentsService) {}

  @Get('me')
  @UseGuards(PlanAccessGuard)
  getMe(@Req() req: any) {
    return this.service.findOne(req.user as AuthenticatedUser);
  }

  @Get('me/settings')
  @UseGuards(PlanAccessGuard)
  getSettings(@Req() req: any) {
    return this.service.getSettings(req.user as AuthenticatedUser);
  }

  @Patch('me/settings')
  @UseGuards(PlanAccessGuard)
  updateSettings(@Body() dto: UpdateSettingsDto, @Req() req: any) {
    return this.service.updateSettings(req.user as AuthenticatedUser, dto);
  }
}
