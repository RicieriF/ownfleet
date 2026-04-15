import {
  Body,
  Controller,
  Delete,
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
import { CouriersService } from './couriers.service.js';
import { CreateCourierDto } from './dto/create-courier.dto.js';
import { UpdateCourierDto } from './dto/update-courier.dto.js';
import { UpdateDeviceTokenDto } from './dto/update-device-token.dto.js';
import { UpdateTransportModeDto } from './dto/update-transport-mode.dto.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';

@Controller('couriers')
@UseGuards(JwtAuthGuard, PlanAccessGuard)
export class CouriersController {
  constructor(private readonly service: CouriersService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.service.findAll(user);
  }

  /** Alias used by dashboard: returns couriers with online_status field */
  @Get('status')
  findAllWithStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.service.findAll(user);
  }

  /**
   * Returns today's workload for all couriers on active shifts.
   * Used by Smart Assignment UI and mobile stats.
   * Cached in Redis: TTL 15s, key workload:{establishment_id}.
   * Accessible by manager, dispatcher, and courier roles.
   */
  @Get('workload-today')
  getWorkloadToday(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getWorkloadToday(user.establishment_id);
  }

  /** Courier fetches own profile including transport_mode */
  @Get('me')
  getMyProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getMyProfile(user);
  }

  /** Courier updates own transport mode */
  @Patch('me/transport-mode')
  @HttpCode(HttpStatus.OK)
  updateMyTransportMode(
    @Body() dto: UpdateTransportModeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateMyTransportMode(dto, user);
  }

  /** Courier self-registers FCM token after login */
  @Patch('me/device-token')
  @HttpCode(HttpStatus.OK)
  updateMyDeviceToken(
    @Body() dto: UpdateDeviceTokenDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateMyDeviceToken(dto, user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  create(
    @Body() dto: CreateCourierDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCourierDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.remove(id, user);
  }

  @Post(':id/remind')
  @HttpCode(HttpStatus.OK)
  remind(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.remindCourier(id, user);
  }
}
