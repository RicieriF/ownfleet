import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PlanAccessGuard } from '../establishments/guards/plan-access.guard.js';
import { OrdersService } from './orders.service.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { AssignOrderDto } from './dto/assign-order.dto.js';
import { AuthenticatedUser } from '../auth/auth.types.js';

class StatusQuery {
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;
}

@Controller('api/v1/orders')
@UseGuards(JwtAuthGuard, PlanAccessGuard)
export class OrdersController {
  constructor(private readonly service: OrdersService) {}

  @Get()
  findAll(@Query() query: StatusQuery, @Req() req: any) {
    return this.service.findAll(req.user as AuthenticatedUser, query.status);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.service.findOne(id, req.user as AuthenticatedUser);
  }

  @Post()
  create(@Body() dto: CreateOrderDto, @Req() req: any) {
    return this.service.create(dto, req.user as AuthenticatedUser);
  }

  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  assign(
    @Param('id') id: string,
    @Body() dto: AssignOrderDto,
    @Req() req: any,
  ) {
    return this.service.assign(id, dto, req.user as AuthenticatedUser);
  }

  @Patch(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id') id: string, @Req() req: any) {
    return this.service.cancel(id, req.user as AuthenticatedUser);
  }
}
