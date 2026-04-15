import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PlanAccessGuard } from '../establishments/guards/plan-access.guard.js';
import { ShiftActiveGuard } from '../shifts/guards/shift-active.guard.js';
import { ProofOfDeliveryService } from './proof-of-delivery.service.js';
import { CompleteDeliveryDto } from './dto/complete-delivery.dto.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';

@Controller('deliveries')
@UseGuards(JwtAuthGuard, PlanAccessGuard)
export class ProofOfDeliveryController {
  constructor(private readonly service: ProofOfDeliveryService) {}

  /** Manager: fetch delivery proof for a completed delivery */
  @Get(':id/proof')
  getProof(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.getDeliveryProof(id, user);
  }

  /** Courier: get their currently active delivery (assigned or in_progress) */
  @Get('active')
  @HttpCode(HttpStatus.OK)
  getActive(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getActiveDelivery(user);
  }

  /** Courier: get their completed/failed delivery history (last 50) */
  @Get('my-history')
  @HttpCode(HttpStatus.OK)
  getMyHistory(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getMyDeliveryHistory(user);
  }

  @Get(':id/upload-url')
  getUploadUrl(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getUploadUrl(id, user);
  }

  @Patch(':id/start')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ShiftActiveGuard)
  start(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.startDelivery(id, user);
  }

  /** Renamed from /complete to /proof — both names now work */
  @Post(':id/proof')
  @HttpCode(HttpStatus.OK)
  proof(
    @Param('id') id: string,
    @Body() dto: CompleteDeliveryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.completeDelivery(id, dto, user);
  }

  /** Keep /complete as alias for backwards compatibility */
  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  complete(
    @Param('id') id: string,
    @Body() dto: CompleteDeliveryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.completeDelivery(id, dto, user);
  }

  @Patch(':id/fail')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ShiftActiveGuard)
  fail(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.failDelivery(id, user);
  }

  /** Manager/owner: force-close a delivery without geo proof (e.g. courier phone died) */
  @Post(':id/force-close')
  @HttpCode(HttpStatus.OK)
  forceClose(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.forceCloseDelivery(id, user);
  }
}
