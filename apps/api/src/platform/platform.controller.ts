import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PlatformAdminGuard } from './guards/platform-admin.guard.js';
import { PlatformService } from './platform.service.js';
import { CreateEstablishmentDto } from './dto/create-establishment.dto.js';
import { ExtendSubscriptionDto } from './dto/extend-subscription.dto.js';
import { ListEstablishmentsDto } from './dto/list-establishments.dto.js';
import { SensitiveResponse } from '../common/decorators/sensitive-response.decorator.js';

@Controller('api/v1/platform')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class PlatformController {
  constructor(private readonly service: PlatformService) {}

  /** GET /api/v1/platform/establishments?limit=50&offset=0 — list tenants (paginated) */
  @Get('establishments')
  listEstablishments(@Query() query: ListEstablishmentsDto) {
    return this.service.listEstablishments(query);
  }

  /** POST /api/v1/platform/establishments — create tenant + credentials */
  @Post('establishments')
  @HttpCode(HttpStatus.CREATED)
  @SensitiveResponse()
  createEstablishment(@Body() dto: CreateEstablishmentDto) {
    return this.service.createEstablishment(dto);
  }

  /** PATCH /api/v1/platform/establishments/:id/subscription — extend by N days */
  @Patch('establishments/:id/subscription')
  @HttpCode(HttpStatus.OK)
  extendSubscription(
    @Param('id') id: string,
    @Body() dto: ExtendSubscriptionDto,
  ) {
    return this.service.extendSubscription(id, dto);
  }
}
