import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PlanAccessGuard } from '../establishments/guards/plan-access.guard.js';
import { ProofOfDeliveryService } from './proof-of-delivery.service.js';
import { CompleteDeliveryDto } from './dto/complete-delivery.dto.js';
import { AuthenticatedUser } from '../auth/auth.types.js';

@Controller('api/v1/deliveries')
@UseGuards(JwtAuthGuard, PlanAccessGuard)
export class ProofOfDeliveryController {
  constructor(private readonly service: ProofOfDeliveryService) {}

  /** Courier: get their currently active delivery (assigned or in_progress) */
  @Get('active')
  @HttpCode(HttpStatus.OK)
  getActive(@Req() req: any) {
    return this.service.getActiveDelivery(req.user as AuthenticatedUser);
  }

  @Get(':id/upload-url')
  getUploadUrl(@Param('id') id: string, @Req() req: any) {
    return this.service.getUploadUrl(id, req.user as AuthenticatedUser);
  }

  @Patch(':id/start')
  @HttpCode(HttpStatus.OK)
  start(@Param('id') id: string, @Req() req: any) {
    return this.service.startDelivery(id, req.user as AuthenticatedUser);
  }

  /** Renamed from /complete to /proof — both names now work */
  @Post(':id/proof')
  @HttpCode(HttpStatus.OK)
  proof(@Param('id') id: string, @Body() dto: CompleteDeliveryDto, @Req() req: any) {
    return this.service.completeDelivery(id, dto, req.user as AuthenticatedUser);
  }

  /** Keep /complete as alias for backwards compatibility */
  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  complete(@Param('id') id: string, @Body() dto: CompleteDeliveryDto, @Req() req: any) {
    return this.service.completeDelivery(id, dto, req.user as AuthenticatedUser);
  }

  @Patch(':id/fail')
  @HttpCode(HttpStatus.OK)
  fail(@Param('id') id: string, @Req() req: any) {
    return this.service.failDelivery(id, req.user as AuthenticatedUser);
  }
}
