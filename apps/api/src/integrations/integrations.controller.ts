import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PlanAccessGuard } from '../establishments/guards/plan-access.guard.js';
import { IntegrationsService } from './integrations.service.js';
import { UpsertIntegrationDto } from './dto/upsert-integration.dto.js';
import { UpdateIntegrationDto } from './dto/update-integration.dto.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';

@Controller('integrations')
@UseGuards(JwtAuthGuard, PlanAccessGuard)
export class IntegrationsController {
  constructor(private readonly service: IntegrationsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.service.findAll(user);
  }

  @Post()
  upsert(
    @Body() dto: UpsertIntegrationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.upsert(user, dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateIntegrationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, user, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.remove(id, user);
  }
}
