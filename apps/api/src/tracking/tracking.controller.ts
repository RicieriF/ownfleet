import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PlanAccessGuard } from '../establishments/guards/plan-access.guard.js';
import { TrackingService } from './tracking.service.js';
import { PingDto } from './dto/ping.dto.js';
import { AuthenticatedUser } from '../auth/auth.types.js';

@Controller('api/v1/tracking')
@UseGuards(JwtAuthGuard, PlanAccessGuard)
export class TrackingController {
  constructor(private readonly service: TrackingService) {}

  @Post('ping')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: 300 } }) // 300 pings / min per IP (covers ~20 couriers at 15s interval)
  async ping(@Body() dto: PingDto, @Req() req: any): Promise<void> {
    await this.service.handlePing(dto, req.user as AuthenticatedUser);
  }

  @Get('couriers/:id/position')
  getPosition(@Param('id') id: string, @Req() req: any) {
    const user = req.user as AuthenticatedUser;
    return this.service.getLastKnownPosition(id, user.establishment_id);
  }
}
