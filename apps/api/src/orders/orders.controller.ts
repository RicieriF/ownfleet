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
import { UpdateCoordinatesDto } from './dto/update-coordinates.dto.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';

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
  findAll(
    @Query('status') status: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // Accept both single status ("pending") and comma-separated ("pending,assigned,in_progress")
    const statuses = status
      ? (status.split(',').filter((s) => s in OrderStatus) as OrderStatus[])
      : undefined;
    return this.service.findAll(user, statuses);
  }

  // Static routes must come before parameterized :id routes
  /** @deprecated Removed in auto-dispatch v2 — self-assignment is no longer supported */
  @Get('available')
  getAvailable() {
    throw new HttpException(
      {
        code: 'ENDPOINT_REMOVED',
        message:
          'Self-assignment removed. Orders are auto-assigned by the system.',
      },
      HttpStatus.GONE,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  create(@Body() dto: CreateOrderDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.create(dto, user);
  }

  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  assign(
    @Param('id') id: string,
    @Body() dto: AssignOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.assign(id, dto, user);
  }

  @Patch(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.cancel(id, user);
  }

  @Patch(':id/coordinates')
  @HttpCode(HttpStatus.OK)
  updateCoordinates(
    @Param('id') id: string,
    @Body() dto: UpdateCoordinatesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateCoordinates(id, dto.lat, dto.lng, user);
  }

  /** @deprecated Removed in auto-dispatch v2 — self-assignment is no longer supported */
  @Post(':id/claim')
  @HttpCode(HttpStatus.GONE)
  claim() {
    throw new HttpException(
      {
        code: 'ENDPOINT_REMOVED',
        message:
          'Self-assignment removed. Orders are auto-assigned by the system.',
      },
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
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // Find the delivery in 'assigned' state for this order
    const delivery = await this.service.findAssignedDelivery(
      id,
      user.establishment_id,
    );
    if (!delivery) {
      throw new NotFoundException({
        code: 'no_assignable_delivery',
        message: 'Активну доставку для перепризначення не знайдено',
      });
    }

    await this.service.reassignDelivery(
      delivery.id,
      dto.courierId,
      user.establishment_id,
    );
    return { reassigned: true };
  }

  /**
   * Mark food as ready for pickup. Sets ready_at timestamp and broadcasts order:ready WS event.
   * Valid for orders in 'pending' or 'assigned' status. Managers/owners only.
   */
  @Post(':id/ready')
  @HttpCode(HttpStatus.OK)
  markReady(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.markReady(id, user);
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
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.assignRecommended(id, dto.courier_id, user);
  }
}
