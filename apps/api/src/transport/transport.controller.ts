import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PlanAccessGuard } from '../establishments/guards/plan-access.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { RecordCheckEventDto } from './dto/record-check-event.dto.js';
import { IssuePassengerQrDto } from './dto/issue-passenger-qr.dto.js';
import { IssueFamilyAccessTokenDto } from './dto/issue-family-access-token.dto.js';
import { FamilyTransportService } from './family-transport.service.js';
import { ReassignTripDto } from './dto/reassign-trip.dto.js';
import { TripAssignmentService } from './trip-assignment.service.js';
import { TransportService } from './transport.service.js';

@Controller('transport')
@UseGuards(JwtAuthGuard, PlanAccessGuard)
export class TransportController {
  constructor(
    private readonly service: TransportService,
    private readonly familyService: FamilyTransportService,
    private readonly assignmentService: TripAssignmentService,
  ) {}

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

  @Post('trip-passengers/:id/qr-token')
  @HttpCode(HttpStatus.CREATED)
  issuePassengerQrToken(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: IssuePassengerQrDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.issuePassengerQrToken(
      id,
      dto.action,
      dto.ttl_seconds,
      user,
    );
  }

  @Post('guardians/:id/access-tokens')
  @HttpCode(HttpStatus.CREATED)
  issueFamilyAccessToken(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: IssueFamilyAccessTokenDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.familyService.issueAccessToken(id, dto.ttl_days, user);
  }

  @Delete('family-access-tokens/:id')
  @HttpCode(HttpStatus.OK)
  revokeFamilyAccessToken(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.familyService.revokeAccessToken(id, user);
  }

  @Post('trips/:id/reassign')
  @HttpCode(HttpStatus.OK)
  reassignTrip(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReassignTripDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assignmentService.reassign(id, dto, user);
  }

  @Post('trips/:id/complete')
  @HttpCode(HttpStatus.OK)
  completeTrip(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.completeTrip(id, user);
  }
}
