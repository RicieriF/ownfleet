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
import { ShiftsService } from './shifts.service';
import { StartShiftDto } from './dto/start-shift.dto';
import { UpdatePlannedEndDto } from './dto/update-planned-end.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlanAccessGuard } from '../establishments/guards/plan-access.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types';

@Controller('shifts')
@UseGuards(JwtAuthGuard, PlanAccessGuard)
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  // ── Courier endpoints ─────────────────────────────────────────────────────

  /** GET /api/v1/shifts/my — courier gets their active shift (or null) */
  @Get('my')
  getMyShift(@CurrentUser() user: AuthenticatedUser) {
    return this.shiftsService.getMyActiveShift(user);
  }

  /** POST /api/v1/shifts/start — courier starts shift */
  @Post('start')
  @HttpCode(HttpStatus.CREATED)
  startShift(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StartShiftDto,
  ) {
    return this.shiftsService.startShift(user, dto);
  }

  /** POST /api/v1/shifts/end — courier ends own shift */
  @Post('end')
  @HttpCode(HttpStatus.OK)
  endShift(@CurrentUser() user: AuthenticatedUser) {
    return this.shiftsService.endShift(user);
  }

  /** GET /api/v1/shifts/my-history — courier gets their last 60 completed shifts */
  @Get('my-history')
  getMyShiftHistory(@CurrentUser() user: AuthenticatedUser) {
    return this.shiftsService.getMyShiftHistory(user);
  }

  // ── Manager endpoints ─────────────────────────────────────────────────────

  /** GET /api/v1/shifts/active — manager gets all active shifts for their establishment */
  @Get('active')
  getActiveShifts(@CurrentUser() user: AuthenticatedUser) {
    return this.shiftsService.getActiveShiftsForEstablishment(user);
  }

  /** PATCH /api/v1/shifts/:id/planned-end — manager updates planned end time */
  @Patch(':id/planned-end')
  updatePlannedEnd(
    @Param('id') shiftId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdatePlannedEndDto,
  ) {
    return this.shiftsService.updatePlannedEnd(shiftId, user, dto);
  }

  /** POST /api/v1/shifts/:id/end — manager force-ends a courier shift */
  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  endShiftByManager(
    @Param('id') shiftId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shiftsService.endShiftByManager(shiftId, user);
  }
}
