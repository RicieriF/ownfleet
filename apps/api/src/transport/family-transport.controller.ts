import {
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { FamilyTransportService } from './family-transport.service.js';

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
}
