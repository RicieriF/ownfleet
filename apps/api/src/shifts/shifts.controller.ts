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
  Request,
} from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { StartShiftDto } from './dto/start-shift.dto';
import { UpdatePlannedEndDto } from './dto/update-planned-end.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlanAccessGuard } from '../establishments/guards/plan-access.guard';
import { JwtPayload } from '../auth/auth.types';

interface RequestWithUser {
  user: JwtPayload;
}

@Controller('api/v1/shifts')
@UseGuards(JwtAuthGuard, PlanAccessGuard)
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  // ── Courier endpoints ─────────────────────────────────────────────────────

  /** GET /api/v1/shifts/my — courier gets their active shift (or null) */
  @Get('my')
  getMyShift(@Request() req: RequestWithUser) {
    return this.shiftsService.getMyActiveShift(req.user);
  }

  /** POST /api/v1/shifts/start — courier starts shift */
  @Post('start')
  @HttpCode(HttpStatus.CREATED)
  startShift(@Request() req: RequestWithUser, @Body() dto: StartShiftDto) {
    return this.shiftsService.startShift(req.user, dto);
  }

  /** POST /api/v1/shifts/end — courier ends own shift */
  @Post('end')
  @HttpCode(HttpStatus.OK)
  endShift(@Request() req: RequestWithUser) {
    return this.shiftsService.endShift(req.user);
  }

  // ── Manager endpoints ─────────────────────────────────────────────────────

  /** GET /api/v1/shifts/active — manager gets all active shifts for their establishment */
  @Get('active')
  getActiveShifts(@Request() req: RequestWithUser) {
    return this.shiftsService.getActiveShiftsForEstablishment(req.user.establishment_id);
  }

  /** PATCH /api/v1/shifts/:id/planned-end — manager updates planned end time */
  @Patch(':id/planned-end')
  updatePlannedEnd(
    @Param('id') shiftId: string,
    @Request() req: RequestWithUser,
    @Body() dto: UpdatePlannedEndDto,
  ) {
    return this.shiftsService.updatePlannedEnd(shiftId, req.user, dto);
  }

  /** POST /api/v1/shifts/:id/end — manager force-ends a courier shift */
  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  endShiftByManager(@Param('id') shiftId: string, @Request() req: RequestWithUser) {
    return this.shiftsService.endShiftByManager(shiftId, req.user);
  }
}
