import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PlanAccessGuard } from '../establishments/guards/plan-access.guard.js';
import { AnalyticsService } from './analytics.service.js';
import {
  AnalyticsQueryDto,
  TimelineQueryDto,
} from './dto/analytics-query.dto.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';

@Controller('analytics')
@UseGuards(JwtAuthGuard, PlanAccessGuard)
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  @Get('summary')
  getSummary(
    @Query() query: AnalyticsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getSummary(user, query.from, query.to);
  }

  @Get('couriers')
  getCourierStats(
    @Query() query: AnalyticsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getCourierStats(user, query.from, query.to);
  }

  @Get('timeline')
  getTimeline(
    @Query() query: TimelineQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getTimeline(
      user,
      query.from,
      query.to,
      query.granularity,
    );
  }
}
