import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { OrderStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PlanAccessGuard } from '../establishments/guards/plan-access.guard.js';
import { OrdersService } from './orders.service.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { AssignOrderDto } from './dto/assign-order.dto.js';
import { AssignRecommendedDto } from './dto/assign-recommended.dto.js';
import { AuthenticatedUser } from '../auth/auth.types.js';

class ReassignOrderDto {
  @IsString()
  @IsNotEmpty()
  courierId!: string;
}

@Controller('orders')
@UseGuards(JwtAuthGuard, PlanAccessGuard)
export class OrdersController {
  constructor(private readonly service: OrdersService) {}

  @Get()
  findAll(@Query('status') status: string | undefined, @Req() req: any) {
    // Accept both single status ("pending") and comma-separated ("pending,assigned,in_progress")
    const statuses = status
      ? (status.split(',').filter((s) => s in OrderStatus) as OrderStatus[])
      : undefined;
    return this.service.findAll(req.user as AuthenticatedUser, statuses);
  }

  // Static routes must come before parameterized :id routes
  /** @deprecated Removed in auto-dispatch v2 — self-assignment is no longer supported */
  @Get('available')
  getAvailable() {
    throw new HttpException(
      { code: 'ENDPOINT_REMOVED', message: 'Self-assignment removed. Orders are auto-assigned by the system.' },
      HttpStatus.GONE,
    );
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

  /** @deprecated Removed in auto-dispatch v2 — self-assignment is no longer supported */
  @Post(':id/claim')
  @HttpCode(HttpStatus.GONE)
  claim() {
    throw new HttpException(
      { code: 'ENDPOINT_REMOVED', message: 'Self-assignment removed. Orders are auto-assigned by the system.' },
      HttpStatus.GONE,
    );
  }

  /**
   * Reassign a delivery that is currently in 'assigned' status to a different courier.
   * Finds the delivery by orderId, then delegates to OrdersService.reassignDelivery.
   */
  @Post(':id/reassign')
  @HttpCode(HttpStatus.OK)
  async reassign(
    @Param('id') id: string,
    @Body() dto: ReassignOrderDto,
    @Req() req: any,
  ) {
    const user = req.user as AuthenticatedUser;

    // Find the delivery in 'assigned' state for this order
    const delivery = await this.service.findAssignedDelivery(id, user.establishment_id);
    if (!delivery) {
      throw new NotFoundException({ code: 'no_assignable_delivery', message: 'Активну доставку для перепризначення не знайдено' });
    }

    await this.service.reassignDelivery(delivery.id, dto.courierId, user.establishment_id);
    return { reassigned: true };
  }

  /**
   * Mark food as ready for pickup. Sets ready_at timestamp and broadcasts order:ready WS event.
   * Valid for orders in 'pending' or 'assigned' status. Managers/owners only.
   */
  @Post(':id/ready')
  @HttpCode(HttpStatus.OK)
  markReady(@Param('id') id: string, @Req() req: any) {
    return this.service.markReady(id, req.user as AuthenticatedUser);
  }

  /**
   * Manager confirms a recommended courier assignment (recommend dispatch mode).
   * Race-safe: uses updateMany to guard against concurrent assignments.
   * Managers/owners only.
   */
  @Post(':id/assign-recommended')
  @HttpCode(HttpStatus.OK)
  assignRecommended(
    @Param('id') id: string,
    @Body() dto: AssignRecommendedDto,
    @Req() req: any,
  ) {
    return this.service.assignRecommended(id, dto.courier_id, req.user as AuthenticatedUser);
  }
}
