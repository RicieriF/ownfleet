import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PlanAccessGuard } from '../establishments/guards/plan-access.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { RecordCheckEventDto } from './dto/record-check-event.dto.js';
import { TransportService } from './transport.service.js';

@Controller('transport')
@UseGuards(JwtAuthGuard, PlanAccessGuard)
export class TransportController {
  constructor(private readonly service: TransportService) {}

  @Post('check-events')
  @HttpCode(HttpStatus.OK)
  recordCheckEvent(
    @Body() dto: RecordCheckEventDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.recordCheckEvent(
      { ...dto, captured_at: new Date(dto.captured_at) },
      user,
    );
  }

  @Post('trips/:id/complete')
  @HttpCode(HttpStatus.OK)
  completeTrip(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.completeTrip(id, user);
  }
}
