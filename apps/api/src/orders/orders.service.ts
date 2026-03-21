import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { AuthenticatedUser } from '../auth/auth.types.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { AssignOrderDto } from './dto/assign-order.dto.js';
import { assertOrderTransition } from './order-state-machine.js';

const ASSIGNMENT_TIMEOUT_MS = 5 * 60_000; // courier has 5 min to accept

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhooksService,
  ) {}

  async findAll(user: AuthenticatedUser, statuses?: OrderStatus[]) {
    return this.prisma.order.findMany({
      where: {
        establishment_id: user.establishment_id,
        ...(statuses && statuses.length > 0
          ? statuses.length === 1
            ? { status: statuses[0] }
            : { status: { in: statuses } }
          : {}),
      },
      include: {
        delivery: {
          include: { courier: { select: { id: true, name: true } } },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async findOne(id: string, user: AuthenticatedUser) {
    return this.assertBelongs(id, user.establishment_id);
  }

  async create(dto: CreateOrderDto, user: AuthenticatedUser) {
    // Idempotency: ON CONFLICT DO NOTHING for POS orders
    if (dto.external_id) {
      const existing = await this.prisma.order.findFirst({
        where: {
          external_id: dto.external_id,
          establishment_id: user.establishment_id,
        },
      });
      if (existing) return existing; // idempotent — return existing
    }

    try {
      const order = await this.prisma.order.create({
        data: {
          establishment_id: user.establishment_id,
          external_id: dto.external_id,
          address: dto.address,
          lat: dto.lat,
          lng: dto.lng,
          source: dto.source ?? 'manual',
          notes: dto.notes,
        },
      });
      this.webhooks.dispatch(user.establishment_id, 'order.created', { order_id: order.id }).catch(
        (err) => this.logger.warn('webhook dispatch failed for order.created', err),
      );
      return order;
    } catch (err) {
      // Race condition: two concurrent requests for the same external_id both passed
      // the findFirst check. The second one hits a unique constraint (P2002).
      if (
        dto.external_id &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const existing = await this.prisma.order.findFirst({
          where: {
            external_id: dto.external_id,
            establishment_id: user.establishment_id,
          },
        });
        if (existing) return existing;
      }
      throw err;
    }
  }

  async assign(id: string, dto: AssignOrderDto, user: AuthenticatedUser) {
    this.assertManagerOrOwner(user);
    const order = await this.assertBelongs(id, user.establishment_id);
    assertOrderTransition(order.status, OrderStatus.assigned);

    // Verify courier belongs to same establishment
    const courier = await this.prisma.courier.findUnique({
      where: { id: dto.courier_id },
    });
    if (!courier || courier.establishment_id !== user.establishment_id) {
      throw new NotFoundException('Courier not found in your establishment');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id },
        data: { status: OrderStatus.assigned },
      });

      await tx.delivery.create({
        data: {
          order_id: id,
          courier_id: dto.courier_id,
          status: 'assigned',
          assignment_timeout_at: new Date(Date.now() + ASSIGNMENT_TIMEOUT_MS),
        },
      }).catch((err) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException('Order is already being assigned');
        }
        throw err;
      });

      return updated;
    });
  }

  async cancel(id: string, user: AuthenticatedUser) {
    this.assertManagerOrOwner(user);
    const order = await this.assertBelongs(id, user.establishment_id);
    assertOrderTransition(order.status, OrderStatus.cancelled);

    const updated = await this.prisma.order.update({
      where: { id },
      data: { status: OrderStatus.cancelled },
    });
    this.webhooks.dispatch(user.establishment_id, 'order.cancelled', { order_id: id }).catch(
      (err) => this.logger.warn('webhook dispatch failed for order.cancelled', err),
    );
    return updated;
  }

  // ── Called internally by ProofOfDeliveryModule ───────────────────────────
  async transitionStatus(
    orderId: string,
    to: OrderStatus,
    establishmentId: string,
  ) {
    const order = await this.assertBelongs(orderId, establishmentId);
    assertOrderTransition(order.status, to);
    return this.prisma.order.update({
      where: { id: orderId },
      data: { status: to },
    });
  }

  private async assertBelongs(orderId: string, establishmentId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.establishment_id !== establishmentId) {
      throw new ForbiddenException('Order does not belong to your establishment');
    }
    return order;
  }

  private assertManagerOrOwner(user: AuthenticatedUser): void {
    if (user.role !== 'owner' && user.role !== 'manager') {
      throw new ForbiddenException('Insufficient permissions');
    }
  }
}
