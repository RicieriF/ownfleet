import { Controller, Get, Post, Patch, Delete, Param, Body, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PlanAccessGuard } from '../establishments/guards/plan-access.guard.js';
import { IntegrationsService } from './integrations.service.js';
import { UpsertIntegrationDto } from './dto/upsert-integration.dto.js';
import { UpdateIntegrationDto } from './dto/update-integration.dto.js';
import { AuthenticatedUser } from '../auth/auth.types.js';

@Controller('integrations')
@UseGuards(JwtAuthGuard, PlanAccessGuard)
export class IntegrationsController {
  constructor(private readonly service: IntegrationsService) {}

  @Get()
  findAll(@Req() req: any) {
    return this.service.findAll(req.user as AuthenticatedUser);
  }

  @Post()
  upsert(@Body() dto: UpsertIntegrationDto, @Req() req: any) {
    return this.service.upsert(req.user as AuthenticatedUser, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateIntegrationDto, @Req() req: any) {
    return this.service.update(id, req.user as AuthenticatedUser, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string, @Req() req: any) {
    return this.service.remove(id, req.user as AuthenticatedUser);
  }
}
