import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PlanAccessGuard } from '../establishments/guards/plan-access.guard.js';
import { ApiKeysService } from './api-keys.service.js';
import { CreateApiKeyDto } from './dto/create-api-key.dto.js';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types.js';

@UseGuards(JwtAuthGuard, PlanAccessGuard)
@Controller('api/v1/establishments/api-key')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  /** Returns current API key metadata (no plaintext key — hash only stored). */
  @Get()
  getKey(@Req() req: Request) {
    return this.apiKeysService.getKey(req.user as AuthenticatedUser);
  }

  /** Generates a new API key. Returns plaintext key ONCE. */
  @Post()
  createKey(@Body() dto: CreateApiKeyDto, @Req() req: Request) {
    return this.apiKeysService.createKey(dto, req.user as AuthenticatedUser);
  }

  /** Toggles is_active on/off. */
  @Patch(':id/toggle')
  toggleActive(@Param('id') id: string, @Req() req: Request) {
    return this.apiKeysService.toggleActive(id, req.user as AuthenticatedUser);
  }
}
