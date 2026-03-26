import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { TelegramService } from '../telegram/telegram.service.js';
import { AuthenticatedUser } from '../auth/auth.types.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { AssignOrderDto } from './dto/assign-order.dto.js';
import { assertOrderTransition } from './order-state-machine.js';
import { EtaService } from '../eta/eta.service.js';
import { TrackingGateway } from '../tracking/tracking.gateway.js';

const ASSIGNMENT_TIMEOUT_MS = 5 * 60_000; // courier has 5 min to accept

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhooksService,
    private readonly telegram: TelegramService,
    private readonly eta: EtaService,
    private readonly gateway: TrackingGateway,
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
      this.telegram.notifyEstablishmentManagers(
        user.establishment_id,
        `📦 Нове замовлення: ${order.address}`,
        'order_created',
      ).catch(() => {});
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

    // Fetch establishment coords + timezone for ETA calculation (fire before transaction)
    const establishment = await this.prisma.establishment.findUniqueOrThrow({
      where: { id: user.establishment_id },
      select: { lat: true, lng: true, timezone: true },
    });

    // Calculate ETA if all coordinates are available and courier has transport mode set
    let etaSeconds: number | null = null;
    if (
      establishment.lat !== null &&
      establishment.lng !== null &&
      order.lat !== null &&
      order.lng !== null &&
      courier.transport_mode !== null
    ) {
      etaSeconds = await this.eta.calculateEta({
        establishmentLat: establishment.lat,
        establishmentLng: establishment.lng,
        orderLat: order.lat,
        orderLng: order.lng,
        transportMode: courier.transport_mode,
        timezone: establishment.timezone,
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
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
          ...(etaSeconds !== null && { eta_seconds: etaSeconds }),
        },
      }).catch((err) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException('Order is already being assigned');
        }
        throw err;
      });

      return updated;
    });

    this.telegram.notifyEstablishmentManagers(
      user.establishment_id,
      `🚴 Доставку призначено курʼєру ${courier.name}: ${order.address}`,
      'delivery_assigned',
    ).catch(() => {});
    this.telegram.notifyCourier(
      dto.courier_id,
      `📦 Вам призначено доставку: ${order.address}`,
      'delivery_assigned',
    ).catch(() => {});

    return result;
  }

  // ── Courier self-assignment (auto_dispatch mode) ─────────────────────────

  async getAvailable(user: AuthenticatedUser) {
    await Promise.all([
      this.fetchEstablishmentForDispatch(user.establishment_id),
      this.assertCourierOnShift(user),
    ]);

    return this.prisma.order.findMany({
      where: { establishment_id: user.establishment_id, status: 'pending' },
      select: { id: true, address: true, lat: true, lng: true, notes: true, created_at: true },
      orderBy: { created_at: 'asc' },
    });
  }

  async claim(orderId: string, user: AuthenticatedUser) {
    if (!user.courier_id) {
      throw new ForbiddenException('Only couriers can claim orders');
    }

    const [est] = await Promise.all([
      this.fetchEstablishmentForDispatch(user.establishment_id),
      this.assertCourierOnShift(user),
    ]);

    // Fetch order (pre-check, real guard is inside transaction)
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.establishment_id !== user.establishment_id) {
      throw new NotFoundException('Order not found');
    }
    if (order.status !== 'pending') {
      throw new ConflictException('Order is no longer available');
    }

    // Fetch courier transport_mode for ETA (outside transaction — no HTTP during tx)
    const courier = await this.prisma.courier.findUniqueOrThrow({
      where: { id: user.courier_id },
      select: { name: true, transport_mode: true },
    });

    let etaSeconds: number | null = null;
    if (
      est.lat !== null && est.lng !== null &&
      order.lat !== null && order.lng !== null &&
      courier.transport_mode !== null
    ) {
      etaSeconds = await this.eta.calculateEta({
        establishmentLat: est.lat,
        establishmentLng: est.lng,
        orderLat: order.lat,
        orderLng: order.lng,
        transportMode: courier.transport_mode,
        timezone: est.timezone,
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Atomic claim: only succeeds if order is still pending
      const updated = await tx.order.updateMany({
        where: { id: orderId, status: 'pending' },
        data: { status: 'assigned' },
      });

      if (updated.count === 0) {
        throw new ConflictException('Order has already been claimed by another courier');
      }

      await tx.delivery.create({
        data: {
          order_id: orderId,
          courier_id: user.courier_id!,
          status: 'assigned',
          assignment_timeout_at: new Date(Date.now() + ASSIGNMENT_TIMEOUT_MS),
          ...(etaSeconds !== null && { eta_seconds: etaSeconds }),
        },
      });

      return tx.order.findUniqueOrThrow({ where: { id: orderId } });
    });

    try { this.gateway.broadcastToEstablishment(user.establishment_id, 'order:assigned', { order_id: orderId }); } catch (err) { this.logger.warn('WS broadcast failed for order:assigned', err); }
    this.telegram.notifyEstablishmentManagers(
      user.establishment_id,
      `🚴 Курʼєр ${courier.name} самостійно взяв замовлення: ${order.address}`,
      'delivery_assigned',
    ).catch(() => {});
    this.telegram.notifyCourier(
      user.courier_id,
      `📦 Ви взяли доставку: ${order.address}`,
      'delivery_assigned',
    ).catch(() => {});
    this.webhooks.dispatch(user.establishment_id, 'order.assigned', { order_id: orderId }).catch(
      (err) => this.logger.warn('webhook dispatch failed for order.assigned', err),
    );

    return result;
  }

  // Verifies auto_dispatch is enabled and returns establishment data needed for ETA
  private async fetchEstablishmentForDispatch(establishmentId: string) {
    const est = await this.prisma.establishment.findUniqueOrThrow({
      where: { id: establishmentId },
      select: { auto_dispatch: true, lat: true, lng: true, timezone: true },
    });
    if (!est.auto_dispatch) {
      throw new BadRequestException('Self-assignment is not enabled for this establishment');
    }
    return est;
  }

  private async assertCourierOnShift(user: AuthenticatedUser) {
    if (!user.courier_id) {
      throw new ForbiddenException('Only couriers can access available orders');
    }
    const activeShift = await this.prisma.shift.findFirst({
      where: { courier_id: user.courier_id, establishment_id: user.establishment_id, ended_at: null },
    });
    if (!activeShift) {
      throw new BadRequestException('You must be on an active shift to access available orders');
    }
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
