import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { FamilyTransportService } from './family-transport.service.js';
import { CreateQrExceptionDto } from './dto/create-qr-exception.dto.js';
import { RegisterFamilyDeviceDto } from './dto/register-family-device.dto.js';

@Controller('transport/family')
export class FamilyTransportController {
  constructor(private readonly service: FamilyTransportService) {}

  @Get('home/:id')
  getHome(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('x-family-token') token?: string,
  ) {
    return this.service.getHome(id, token);
  }

  @Post('home/:id/ready')
  @HttpCode(HttpStatus.OK)
  markReady(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('x-family-token') token?: string,
  ) {
    return this.service.markReady(id, token);
  }

  @Post('passengers/:id/qr-exceptions')
  @HttpCode(HttpStatus.CREATED)
  createQrException(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateQrExceptionDto,
    @Headers('x-family-token') token?: string,
  ) {
    return this.service.createQrException(
      id,
      {
        ...dto,
        valid_from: new Date(dto.valid_from),
        valid_until: new Date(dto.valid_until),
      },
      token,
    );
  }

  @Delete('qr-exceptions/:id')
  @HttpCode(HttpStatus.OK)
  revokeQrException(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('x-family-token') token?: string,
  ) {
    return this.service.revokeQrException(id, token);
  }

  @Post('device')
  @HttpCode(HttpStatus.OK)
  registerDevice(
    @Body() dto: RegisterFamilyDeviceDto,
    @Headers('x-family-token') token?: string,
  ) {
    return this.service.registerDevice(dto.device_token, dto.platform, token);
  }

  @Delete('device')
  @HttpCode(HttpStatus.OK)
  unregisterDevice(@Headers('x-family-token') token?: string) {
    return this.service.unregisterDevice(token);
  }
}
