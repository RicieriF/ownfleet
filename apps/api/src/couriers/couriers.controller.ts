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
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PlanAccessGuard } from '../establishments/guards/plan-access.guard.js';
import { CouriersService } from './couriers.service.js';
import { CreateCourierDto } from './dto/create-courier.dto.js';
import { UpdateCourierDto } from './dto/update-courier.dto.js';
import { RegisterDeviceTokenDto } from './dto/register-device-token.dto.js';
import { UpdateDeviceTokenDto } from './dto/update-device-token.dto.js';
import { AuthenticatedUser } from '../auth/auth.types.js';

@Controller('api/v1/couriers')
@UseGuards(JwtAuthGuard, PlanAccessGuard)
export class CouriersController {
  constructor(private readonly service: CouriersService) {}

  @Get()
  findAll(@Req() req: any) {
    return this.service.findAll(req.user as AuthenticatedUser);
  }

  /** Alias used by dashboard: returns couriers with online_status field */
  @Get('status')
  findAllWithStatus(@Req() req: any) {
    return this.service.findAll(req.user as AuthenticatedUser);
  }

  /** Courier self-registers FCM token after login */
  @Patch('me/device-token')
  @HttpCode(HttpStatus.OK)
  updateMyDeviceToken(@Body() dto: UpdateDeviceTokenDto, @Req() req: any) {
    return this.service.updateMyDeviceToken(dto, req.user as AuthenticatedUser);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.service.findOne(id, req.user as AuthenticatedUser);
  }

  @Post()
  create(@Body() dto: CreateCourierDto, @Req() req: any) {
    return this.service.create(dto, req.user as AuthenticatedUser);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCourierDto,
    @Req() req: any,
  ) {
    return this.service.update(id, dto, req.user as AuthenticatedUser);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @Req() req: any) {
    return this.service.remove(id, req.user as AuthenticatedUser);
  }

  @Post(':id/remind')
  @HttpCode(HttpStatus.OK)
  remind(@Param('id') id: string, @Req() req: any) {
    return this.service.remindCourier(id, req.user as AuthenticatedUser);
  }

  @Post(':id/device-token')
  @HttpCode(HttpStatus.OK)
  registerDeviceToken(
    @Param('id') id: string,
    @Body() dto: RegisterDeviceTokenDto,
    @Req() req: any,
  ) {
    return this.service.registerDeviceToken(id, dto, req.user as AuthenticatedUser);
  }
}
