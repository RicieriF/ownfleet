import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PlanAccessGuard } from '../establishments/guards/plan-access.guard.js';
import { TrackingService } from './tracking.service.js';
import { PingDto } from './dto/ping.dto.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';

@Controller('tracking')
@UseGuards(JwtAuthGuard, PlanAccessGuard)
export class TrackingController {
  constructor(private readonly service: TrackingService) {}

  @Post('ping')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: 10 } }) // 10 pings / min per courier (15s interval = 4/min, 10 gives headroom)
  async ping(
    @Body() dto: PingDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.service.handlePing(dto, user);
  }

  @Get('couriers/:id/position')
  getPosition(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    if (user.courier_id) {
      throw new ForbiddenException(
        'Courier accounts cannot query other courier positions',
      );
    }
    return this.service.getLastKnownPosition(id, user.establishment_id);
  }
}
