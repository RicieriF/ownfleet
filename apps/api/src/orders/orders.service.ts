import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  Logger,
  Inject,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { DispatchMode, OrderStatus, TransportMode, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { TelegramService } from '../telegram/telegram.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { CouriersService } from '../couriers/couriers.service.js';
import { AuthenticatedUser } from '../auth/auth.types.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { AssignOrderDto } from './dto/assign-order.dto.js';
import { assertOrderTransition } from './order-state-machine.js';
import { EtaService } from '../eta/eta.service.js';
import { TrackingGateway } from '../tracking/tracking.gateway.js';
import { TrackingService } from '../tracking/tracking.service.js';
import { GeocodingService } from '../geocoding/geocoding.service.js';
import { REDIS_CLIENT, PUBLIC_DELIVERY_STATUS_CHANNEL } from '../shared/redis/redis.constants.js';
import { haversineMeters } from '../shared/geo.js';
import { MANAGER_EVENT, COURIER_EVENT } from '../telegram/telegram.types.js';
import type IORedis from 'ioredis';


// Distance tiers for dispatch algorithm (in meters)
const ZONE_1_METERS = 150;
const ZONE_2_METERS = 1000;

// Transport distance warnings (order delivery distance, in meters)
const WALKING_WARN_METERS = 2000;
const BICYCLE_WARN_METERS = 8000;

export interface CourierWithEta {
  courierId: string;
  name: string;
  transportMode: TransportMode;
  distanceMeters: number;
  workloadSeconds: number;
  deliveriesCount: number;
  etaSeconds: number;
  transportWarning?: string;
}

export type DispatchResult =
  | { waiting: true }
  | { error: 'eta_unavailable'; canRetry: true }
  | {
      recommended: CourierWithEta;
      pool: CourierWithEta[];
      /** Included so callers do not need a second DB round-trip to check the mode. */
      dispatchMode: DispatchMode;
    };

// Raw row returned by workload $queryRaw
interface WorkloadRow {
  courier_id: string;
  name: string;
  transport_mode: TransportMode;
  workload_score: string | number; // Postgres returns numeric as string
  deliveries_count: string | number;
  distance_meters: string | number;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhooksService,
    private readonly telegram: TelegramService,
    private readonly notifications: NotificationsService,
    private readonly eta: EtaService,
    private readonly gateway: TrackingGateway,
    private readonly trackingService: TrackingService,
    private readonly couriersService: CouriersService,
    private readonly geocodingService: GeocodingService,
    @InjectQueue('dispatch') private readonly dispatchQueue: Queue,
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
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
      // Geocode if coordinates are missing or the 0,0 sentinel (same logic as POS integrations)
      if (order.lat == null || order.lng == null || (order.lat === 0 && order.lng === 0)) {
        void this.geocodingService.enqueueGeocode(order.id, order.address, user.establishment_id);
      }
      this.webhooks.dispatch(user.establishment_id, 'order.created', { order_id: order.id }).catch(
        (err) => this.logger.warn('webhook dispatch failed for order.created', err),
      );
      this.telegram.notifyEstablishmentManagers(
        user.establishment_id,
        `📦 Нове замовлення: ${order.address}`,
        MANAGER_EVENT.ORDER_CREATED,
      ).catch((err: unknown) => this.logger.warn('Telegram notification failed (order_created)', err));
      // Trigger auto-dispatch if establishment has dispatch_mode='auto'
      void this.prisma.establishment.findUnique({
        where: { id: user.establishment_id },
        select: { dispatch_mode: true },
      }).then((est) => {
        if (est?.dispatch_mode === 'auto') {
          return this.dispatchQueue.add(
            { orderId: order.id, establishmentId: user.establishment_id, attempt: 1 },
            { jobId: `dispatch:${order.id}` },
          );
        }
      }).catch((err) => this.logger.warn('Failed to enqueue dispatch', err));
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
      // Atomic status guard: only succeeds if order is still pending.
      // Prevents assign-after-cancel and double-assign races.
      const orderUpdate = await tx.order.updateMany({
        where: { id, status: OrderStatus.pending },
        data: { status: OrderStatus.assigned },
      });
      if (orderUpdate.count === 0) {
        throw new ConflictException('Order status has changed, cannot assign');
      }

      await tx.delivery.create({
        data: {
          order_id: id,
          courier_id: dto.courier_id,
          status: 'assigned',
          ...(etaSeconds !== null && { eta_seconds: etaSeconds }),
        },
      }).catch((err) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException('Order is already being assigned');
        }
        throw err;
      });

      return tx.order.findUniqueOrThrow({ where: { id } });
    });

    this.telegram.notifyEstablishmentManagers(
      user.establishment_id,
      `🚴 Доставку призначено курʼєру ${courier.name}: ${order.address}`,
      MANAGER_EVENT.DELIVERY_ASSIGNED,
    ).catch((err: unknown) => this.logger.warn('Telegram notification failed (delivery_assigned manager)', err));
    this.telegram.notifyCourier(
      dto.courier_id,
      `📦 Вам призначено доставку: ${order.address}`,
      COURIER_EVENT.DELIVERY_ASSIGNED,
    ).catch((err: unknown) => this.logger.warn('Telegram notification failed (delivery_assigned courier)', err));

    // Set courier:active_order Redis key for public tracking
    const createdDelivery = await this.prisma.delivery.findFirst({
      where: { order_id: id },
      select: { id: true },
      orderBy: { assigned_at: 'desc' },
    });
    if (createdDelivery) {
      this.trackingService.setActiveOrder(
        dto.courier_id,
        id,
        createdDelivery.id,
        order.lat,
        order.lng,
        courier.transport_mode,
        establishment.lat,
        establishment.lng,
      ).catch((err) => this.logger.warn('setActiveOrder failed after assign', err));
    }

    // Publish delivery status for public WS
    this.redis.publish(
      PUBLIC_DELIVERY_STATUS_CHANNEL,
      JSON.stringify({ orderId: id, orderStatus: 'assigned', deliveryStatus: 'assigned' }),
    ).catch((err: unknown) => this.logger.warn('Redis publish failed (delivery_assigned)', err));

    // Invalidate workload cache — fire-and-forget
    this.couriersService.invalidateWorkloadCache(user.establishment_id).catch((err) =>
      this.logger.warn('Failed to invalidate workload cache after assign', err),
    );

    return result;
  }

  // ── Courier self-assignment (deprecated — endpoints return 410) ───────────

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
          ...(etaSeconds !== null && { eta_seconds: etaSeconds }),
        },
      });

      return tx.order.findUniqueOrThrow({ where: { id: orderId } });
    });

    try { this.gateway.broadcastToEstablishment(user.establishment_id, 'order:assigned', { order_id: orderId }); } catch (err) { this.logger.warn('WS broadcast failed for order:assigned', err); }
    this.telegram.notifyEstablishmentManagers(
      user.establishment_id,
      `🚴 Курʼєр ${courier.name} самостійно взяв замовлення: ${order.address}`,
      MANAGER_EVENT.DELIVERY_ASSIGNED,
    ).catch((err: unknown) => this.logger.warn('Telegram notification failed (self_assign manager)', err));
    this.telegram.notifyCourier(
      user.courier_id,
      `📦 Ви взяли доставку: ${order.address}`,
      COURIER_EVENT.DELIVERY_ASSIGNED,
    ).catch((err: unknown) => this.logger.warn('Telegram notification failed (self_assign courier)', err));
    this.webhooks.dispatch(user.establishment_id, 'order.assigned', { order_id: orderId }).catch(
      (err) => this.logger.warn('webhook dispatch failed for order.assigned', err),
    );

    // Set courier:active_order Redis key for public tracking
    const claimedDelivery = await this.prisma.delivery.findFirst({
      where: { order_id: orderId },
      select: { id: true },
      orderBy: { assigned_at: 'desc' },
    });
    if (claimedDelivery) {
      this.trackingService.setActiveOrder(
        user.courier_id!,
        orderId,
        claimedDelivery.id,
        order.lat,
        order.lng,
        courier.transport_mode,
        est.lat,
        est.lng,
      ).catch((err) => this.logger.warn('setActiveOrder failed after claim', err));
    }
    this.redis.publish(
      PUBLIC_DELIVERY_STATUS_CHANNEL,
      JSON.stringify({ orderId, orderStatus: 'assigned', deliveryStatus: 'assigned' }),
    ).catch((err: unknown) => this.logger.warn('Redis publish failed (self_assign)', err));

    return result;
  }

  // ── Dispatch algorithm ───────────────────────────────────────────────────

  /**
   * Builds the eligible courier pool, applies proximity tiers and workload scoring,
   * calculates OSRM ETA for each courier, and returns a ranked result.
   *
   * For `auto` dispatch_mode this also calls assignCourier() internally.
   * Does NOT create Bull jobs — that's handled by the caller.
   */
  async runDispatchAlgorithm(
    orderId: string,
    establishmentId: string,
  ): Promise<DispatchResult> {
    const [order, establishment] = await Promise.all([
      this.prisma.order.findUnique({ where: { id: orderId } }),
      this.prisma.establishment.findUnique({
        where: { id: establishmentId },
        select: { id: true, lat: true, lng: true, timezone: true, dispatch_mode: true },
      }),
    ]);

    if (!order || order.establishment_id !== establishmentId) {
      throw new NotFoundException('Order not found');
    }
    if (!establishment) {
      throw new NotFoundException('Establishment not found');
    }
    if (establishment.lat === null || establishment.lng === null) {
      // Cannot filter by proximity without establishment coordinates
      return { waiting: true };
    }

    const estLat = establishment.lat;
    const estLng = establishment.lng;

    // Step 1 + 3 — pool query with workload score via $queryRaw (PostGIS)
    const rows = await this.prisma.$queryRaw<WorkloadRow[]>`
      SELECT
        c.id AS courier_id,
        c.name,
        c.transport_mode,
        COALESCE(SUM(EXTRACT(EPOCH FROM (d.completed_at - d.started_at))), 0)
          + COALESCE(SUM(CASE WHEN d.status IN ('assigned','in_progress') THEN d.eta_seconds ELSE 0 END), 0)
        AS workload_score,
        COUNT(d.id) FILTER (WHERE d.completed_at IS NOT NULL) AS deliveries_count,
        ST_Distance(
          ST_Transform(lp.location::geometry, 3857),
          ST_Transform(ST_SetSRID(ST_MakePoint(${estLng}, ${estLat}), 4326), 3857)
        ) AS distance_meters
      FROM couriers c
      JOIN shifts s ON s.courier_id = c.id AND s.ended_at IS NULL AND s.establishment_id = ${establishmentId}
      LEFT JOIN deliveries d ON d.courier_id = c.id
        AND d.started_at >= s.started_at
        AND d.status NOT IN ('failed')
      LEFT JOIN LATERAL (
        SELECT location FROM location_pings
        WHERE courier_id = c.id
        ORDER BY created_at DESC
        LIMIT 1
      ) lp ON true
      WHERE c.establishment_id = ${establishmentId}
        AND c.active = true
        AND c.transport_mode IS NOT NULL
        AND lp.location IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM location_pings lp2
          WHERE lp2.courier_id = c.id
          AND lp2.created_at > NOW() - INTERVAL '5 minutes'
        )
        AND NOT EXISTS (
          SELECT 1 FROM deliveries d2
          WHERE d2.courier_id = c.id
          AND d2.status IN ('assigned', 'in_progress')
        )
        AND ST_DWithin(
          ST_Transform(lp.location::geometry, 3857),
          ST_Transform(ST_SetSRID(ST_MakePoint(${estLng}, ${estLat}), 4326), 3857),
          ${ZONE_2_METERS}
        )
      GROUP BY c.id, c.name, c.transport_mode, lp.location, s.started_at
      ORDER BY workload_score ASC, deliveries_count ASC, s.started_at ASC
    `;

    if (rows.length === 0) {
      return { waiting: true };
    }

    // Step 2 — proximity tiers: prefer zone 1, fall back to zone 2
    const zone1 = rows.filter((r) => Number(r.distance_meters) < ZONE_1_METERS);
    const candidates = zone1.length > 0 ? zone1 : rows;

    // Step — calculate order delivery distance for transport warnings
    const orderDistanceMeters =
      order.lat !== null && order.lng !== null
        ? haversineMeters(estLat, estLng, order.lat, order.lng)
        : null;

    // Step — calculate OSRM ETA deduplicated by transport mode.
    // All couriers share the same establishment→order route; only transport_mode varies.
    // This collapses N parallel OSRM calls down to ≤ 4 unique profiles
    // (driving / cycling / foot — moto_electric reuses driving with a speed factor).
    const etaByMode = new Map<TransportMode, number | null>();
    if (order.lat !== null && order.lng !== null) {
      const uniqueModes = [...new Set(candidates.map((c) => c.transport_mode))];
      await Promise.allSettled(
        uniqueModes.map(async (mode) => {
          const eta = await this.eta.calculateEta({
            establishmentLat: estLat,
            establishmentLng: estLng,
            orderLat: order.lat!,
            orderLng: order.lng!,
            transportMode: mode,
            timezone: establishment.timezone,
          });
          etaByMode.set(mode, eta);
        }),
      );
    }

    // Step 4 — build CourierWithEta list from candidates whose ETA succeeded
    const pool: CourierWithEta[] = [];
    for (const c of candidates) {
      const etaSeconds = etaByMode.get(c.transport_mode) ?? null;
      if (etaSeconds === null) {
        this.logger.warn(
          `OSRM ETA unavailable for courier ${c.courier_id} (${c.transport_mode})`,
        );
        continue;
      }
      const distanceMeters = Number(c.distance_meters);
      const transportWarning = this.buildTransportWarning(c.transport_mode, orderDistanceMeters);
      pool.push({
        courierId: c.courier_id,
        name: c.name,
        transportMode: c.transport_mode,
        distanceMeters,
        workloadSeconds: Number(c.workload_score),
        deliveriesCount: Number(c.deliveries_count),
        etaSeconds,
        ...(transportWarning ? { transportWarning } : {}),
      });
    }

    if (pool.length === 0) {
      return { error: 'eta_unavailable', canRetry: true };
    }

    // Sort pool: zone 1 first, then by workload_score (already sorted by SQL, but ETA parallel
    // does not change order so SQL ordering stands)
    const recommended = pool[0]!;

    // For `auto` mode — assign immediately
    if (establishment.dispatch_mode === 'auto') {
      try {
        await this.assignCourier(orderId, recommended.courierId, establishmentId);
      } catch (err) {
        this.logger.warn(`Auto-assign failed for order ${orderId}`, err);
        // Return result anyway — caller handles the error display
      }
    }

    return { recommended, pool, dispatchMode: establishment.dispatch_mode };
  }

  /**
   * Internal method used by runDispatchAlgorithm and POST /assign-recommended.
   * Assigns a courier to an order without going through the HTTP layer.
   * Mirrors assign() but accepts raw IDs.
   */
  async assignCourier(
    orderId: string,
    courierId: string,
    establishmentId: string,
  ): Promise<void> {
    const [order, courier, establishment] = await Promise.all([
      this.prisma.order.findUnique({ where: { id: orderId } }),
      this.prisma.courier.findUnique({ where: { id: courierId } }),
      this.prisma.establishment.findUnique({
        where: { id: establishmentId },
        select: { lat: true, lng: true, timezone: true },
      }),
    ]);

    if (!order || order.establishment_id !== establishmentId) {
      throw new NotFoundException('Order not found');
    }
    if (!courier || courier.establishment_id !== establishmentId) {
      throw new NotFoundException('Courier not found in your establishment');
    }
    if (!establishment) {
      throw new NotFoundException('Establishment not found');
    }

    // Validate that order is currently pending (pre-flight check — final guard is atomic inside tx)
    assertOrderTransition(order.status, OrderStatus.assigned);

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

    await this.prisma.$transaction(async (tx) => {
      // Atomic race guard: only proceeds if order is still pending at commit time
      const updated = await tx.order.updateMany({
        where: { id: orderId, status: OrderStatus.pending },
        data: { status: OrderStatus.assigned },
      });
      if (updated.count === 0) {
        throw new ConflictException('Order has already been assigned');
      }
      await tx.delivery.create({
        data: {
          order_id: orderId,
          courier_id: courierId,
          status: 'assigned',
          ...(etaSeconds !== null && { eta_seconds: etaSeconds }),
        },
      });
    });

    // FCM push to courier — fire-and-forget
    this.notifications
      .sendPush(courierId, {
        title: 'Нова доставка',
        body: `Вам призначено доставку: ${order.address}`,
        data: { type: 'delivery_assigned', order_id: orderId },
      })
      .catch((err) => this.logger.warn(`FCM push failed for courier ${courierId}`, err));

    try {
      this.gateway.broadcastToEstablishment(establishmentId, 'order:assigned', {
        order_id: orderId,
        courier_id: courierId,
      });
    } catch (err) {
      this.logger.warn('WS broadcast failed for order:assigned', err);
    }

    this.telegram
      .notifyEstablishmentManagers(
        establishmentId,
        `🚴 Доставку призначено курʼєру ${courier.name}: ${order.address}`,
        MANAGER_EVENT.DELIVERY_ASSIGNED,
      )
      .catch((err: unknown) => this.logger.warn('Telegram notification failed (auto_assign manager)', err));

    // Set courier:active_order Redis key for public tracking
    const assignedDelivery = await this.prisma.delivery.findFirst({
      where: { order_id: orderId },
      select: { id: true },
      orderBy: { assigned_at: 'desc' },
    });
    if (assignedDelivery) {
      this.trackingService.setActiveOrder(
        courierId,
        orderId,
        assignedDelivery.id,
        order.lat,
        order.lng,
        courier.transport_mode,
        establishment.lat,
        establishment.lng,
      ).catch((err) => this.logger.warn('setActiveOrder failed after assignCourier', err));
    }
    this.redis.publish(
      PUBLIC_DELIVERY_STATUS_CHANNEL,
      JSON.stringify({ orderId, orderStatus: 'assigned', deliveryStatus: 'assigned' }),
    ).catch((err: unknown) => this.logger.warn('Redis publish failed (auto_assign)', err));

    // Invalidate workload cache — fire-and-forget
    this.couriersService.invalidateWorkloadCache(establishmentId).catch((err) =>
      this.logger.warn('Failed to invalidate workload cache after assignCourier', err),
    );
  }

  /**
   * Reassigns an existing delivery (status must be 'assigned') to a new courier.
   * Does NOT change delivery status — only updates courier_id.
   */
  async reassignDelivery(
    deliveryId: string,
    newCourierId: string,
    establishmentId: string,
  ): Promise<void> {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      include: {
        order: { select: { establishment_id: true, address: true } },
        courier: { select: { id: true, name: true } },
      },
    });

    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }
    if (delivery.order.establishment_id !== establishmentId) {
      throw new ForbiddenException('Delivery does not belong to your establishment');
    }
    if (delivery.status !== 'assigned') {
      throw new ConflictException(
        'Delivery cannot be reassigned — must be in "assigned" status',
      );
    }

    // Validate new courier is available (no active delivery)
    const newCourier = await this.prisma.courier.findUnique({
      where: { id: newCourierId },
      select: { id: true, name: true, establishment_id: true },
    });

    if (!newCourier || newCourier.establishment_id !== establishmentId) {
      throw new NotFoundException('New courier not found in your establishment');
    }

    const activeDelivery = await this.prisma.delivery.findFirst({
      where: {
        courier_id: newCourierId,
        status: { in: ['assigned', 'in_progress'] },
      },
    });
    if (activeDelivery) {
      throw new ConflictException('New courier already has an active delivery');
    }

    const oldCourierId = delivery.courier_id;

    await this.prisma.delivery.update({
      where: { id: deliveryId },
      data: { courier_id: newCourierId },
    });

    // FCM push to old courier — fire-and-forget
    this.notifications
      .sendPush(oldCourierId, {
        title: 'Доставку перепризначено',
        body: `Доставку ${delivery.order.address} перепризначено іншому курʼєру`,
        data: { type: 'delivery_reassigned', delivery_id: deliveryId },
      })
      .catch((err) =>
        this.logger.warn(`FCM push (reassigned) failed for old courier ${oldCourierId}`, err),
      );

    // FCM push to new courier — fire-and-forget
    this.notifications
      .sendPush(newCourierId, {
        title: 'Нова доставка',
        body: `Вам призначено доставку: ${delivery.order.address}`,
        data: { type: 'delivery_assigned', delivery_id: deliveryId },
      })
      .catch((err) =>
        this.logger.warn(`FCM push (assign) failed for new courier ${newCourierId}`, err),
      );

    try {
      this.gateway.broadcastToEstablishment(establishmentId, 'delivery:reassigned', {
        delivery_id: deliveryId,
        old_courier_id: oldCourierId,
        new_courier_id: newCourierId,
      });
    } catch (err) {
      this.logger.warn('WS broadcast failed for delivery:reassigned', err);
    }

    // DEL old courier active_order, SET new courier active_order
    this.trackingService.clearActiveOrder(oldCourierId, deliveryId).catch((err: unknown) =>
      this.logger.warn('clearActiveOrder failed on reassign (old courier)', err),
    );

    // Fetch order + establishment coords for new active_order key
    void this.prisma.order.findUnique({
      where: { id: delivery.order_id },
      select: { lat: true, lng: true, establishment: { select: { lat: true, lng: true } } },
    }).then((ord) => {
      if (!ord) return;
      return this.prisma.courier.findUnique({
        where: { id: newCourierId },
        select: { transport_mode: true },
      }).then((c) => {
        return this.trackingService.setActiveOrder(
          newCourierId,
          delivery.order_id,
          deliveryId,
          ord.lat,
          ord.lng,
          c?.transport_mode ?? null,
          ord.establishment.lat,
          ord.establishment.lng,
        );
      });
    }).catch((err) => this.logger.warn('setActiveOrder failed after reassign', err));

    this.redis.publish(
      PUBLIC_DELIVERY_STATUS_CHANNEL,
      JSON.stringify({ orderId: delivery.order_id, orderStatus: 'assigned', deliveryStatus: 'assigned' }),
    ).catch((err: unknown) => this.logger.warn('Redis publish failed (reassign)', err));

    // Invalidate workload cache — fire-and-forget
    this.couriersService.invalidateWorkloadCache(establishmentId).catch((err) =>
      this.logger.warn('Failed to invalidate workload cache after reassignDelivery', err),
    );
  }

  private buildTransportWarning(
    mode: TransportMode,
    orderDistanceMeters: number | null,
  ): string | undefined {
    if (orderDistanceMeters === null) return undefined;
    if (mode === TransportMode.walking && orderDistanceMeters > WALKING_WARN_METERS) {
      return `Доставка ${(orderDistanceMeters / 1000).toFixed(1)} км — велика відстань для пішки`;
    }
    if (mode === TransportMode.bicycle && orderDistanceMeters > BICYCLE_WARN_METERS) {
      return `Доставка ${(orderDistanceMeters / 1000).toFixed(1)} км — велика відстань для велосипеда`;
    }
    return undefined;
  }

  // Verifies dispatch_mode allows self-assignment and returns establishment data needed for ETA
  private async fetchEstablishmentForDispatch(establishmentId: string) {
    const est = await this.prisma.establishment.findUniqueOrThrow({
      where: { id: establishmentId },
      select: { dispatch_mode: true, lat: true, lng: true, timezone: true },
    });
    if (est.dispatch_mode !== 'auto') {
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

    // Fetch active delivery before cancellation (for Redis cleanup)
    const activeDelivery = await this.prisma.delivery.findFirst({
      where: { order_id: id, status: { in: ['assigned', 'in_progress'] } },
      select: { id: true, courier_id: true },
    });

    const updated = await this.prisma.order.update({
      where: { id },
      data: { status: OrderStatus.cancelled },
    });

    // DEL Redis keys if an active delivery existed
    if (activeDelivery) {
      this.trackingService
        .clearActiveOrder(activeDelivery.courier_id, activeDelivery.id)
        .catch((err: unknown) => this.logger.warn('clearActiveOrder failed on cancel', err));
    }

    // Publish order:cancelled for public WS
    this.redis.publish(
      PUBLIC_DELIVERY_STATUS_CHANNEL,
      JSON.stringify({ orderId: id, orderStatus: 'cancelled', deliveryStatus: null }),
    ).catch((err: unknown) => this.logger.warn('Redis publish failed (cancel)', err));

    this.webhooks.dispatch(user.establishment_id, 'order.cancelled', { order_id: id }).catch(
      (err) => this.logger.warn('webhook dispatch failed for order.cancelled', err),
    );
    return updated;
  }

  // ── Mark order food ready (dispatch step 1) ──────────────────────────────

  /**
   * Marks that food is ready for pickup. Sets ready_at timestamp and broadcasts
   * order:ready WS event. Does NOT change order status.
   * Valid for orders in 'pending' or 'assigned' state.
   */
  async markReady(id: string, user: AuthenticatedUser) {
    this.assertManagerOrOwner(user);
    const order = await this.assertBelongs(id, user.establishment_id);

    if (order.status !== OrderStatus.pending && order.status !== OrderStatus.assigned) {
      throw new ConflictException(
        `Cannot mark order ready in status '${order.status}'`,
      );
    }

    // Idempotent: keep the original ready_at if already set to avoid resetting
    // the stale-dispatch timer in retention cron.
    const readyAt = order.ready_at ?? new Date();
    const updated = await this.prisma.order.update({
      where: { id },
      data: { ready_at: readyAt },
    });

    try {
      this.gateway.broadcastToEstablishment(user.establishment_id, 'order:ready', {
        orderId: id,
        readyAt,
      });
    } catch (err) {
      this.logger.warn('WS broadcast failed for order:ready', err);
    }

    // For `recommend` mode: trigger the dispatch algorithm so the SmartAssignmentPanel
    // receives an `order:recommendation` WS event. Only for pending orders — assigned
    // orders already have a courier. The jobId makes this idempotent.
    if (order.status === OrderStatus.pending) {
      void this.prisma.establishment.findUnique({
        where: { id: user.establishment_id },
        select: { dispatch_mode: true },
      }).then((est) => {
        if (est?.dispatch_mode === DispatchMode.recommend) {
          return this.dispatchQueue.add(
            { orderId: id, establishmentId: user.establishment_id, attempt: 1 },
            { jobId: `dispatch:${id}` },
          );
        }
      }).catch((err: unknown) => this.logger.warn('Failed to enqueue dispatch job in markReady', err));
    }

    this.logger.log(`Order ${id} marked ready at ${readyAt.toISOString()}`);
    return updated;
  }

  // ── Manager approves recommended courier (recommend dispatch mode) ────────

  /**
   * Manager confirms a recommended courier assignment.
   * Uses race-safe updateMany to ensure the order is still pending.
   */
  async assignRecommended(
    id: string,
    courierId: string,
    user: AuthenticatedUser,
  ) {
    this.assertManagerOrOwner(user);

    // Pre-flight: verify order exists and belongs to establishment
    const order = await this.assertBelongs(id, user.establishment_id);
    if (order.status !== OrderStatus.pending) {
      throw new ConflictException(
        `Order is not in 'pending' status (current: '${order.status}')`,
      );
    }

    // Verify courier belongs to same establishment
    const courier = await this.prisma.courier.findUnique({
      where: { id: courierId },
    });
    if (!courier || courier.establishment_id !== user.establishment_id) {
      throw new NotFoundException('Courier not found in your establishment');
    }

    // Fetch establishment for ETA calculation
    const establishment = await this.prisma.establishment.findUniqueOrThrow({
      where: { id: user.establishment_id },
      select: { lat: true, lng: true, timezone: true },
    });

    // Calculate ETA outside transaction (HTTP call)
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

    // Race-safe transaction: only proceeds if order is still pending
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.updateMany({
        where: { id, status: 'pending' },
        data: { status: 'assigned' },
      });

      if (updated.count === 0) {
        throw new ConflictException('Order has already been assigned');
      }

      await tx.delivery.create({
        data: {
          order_id: id,
          courier_id: courierId,
          status: 'assigned',
          ...(etaSeconds !== null && { eta_seconds: etaSeconds }),
        },
      }).catch((err) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException('Order is already being assigned');
        }
        throw err;
      });

      return tx.order.findUniqueOrThrow({ where: { id } });
    });

    // FCM push to courier — fire-and-forget
    this.notifications
      .sendPush(courierId, {
        title: 'Нова доставка',
        body: `Вам призначено доставку: ${order.address}`,
        data: { type: 'delivery_assigned', order_id: id },
      })
      .catch((err) => this.logger.warn(`FCM push failed for courier ${courierId}`, err));

    try {
      this.gateway.broadcastToEstablishment(user.establishment_id, 'order:assigned', {
        order_id: id,
        courier_id: courierId,
      });
    } catch (err) {
      this.logger.warn('WS broadcast failed for order:assigned', err);
    }

    this.telegram
      .notifyEstablishmentManagers(
        user.establishment_id,
        `🚴 Доставку призначено курʼєру ${courier.name}: ${order.address}`,
        MANAGER_EVENT.DELIVERY_ASSIGNED,
      )
      .catch((err: unknown) => this.logger.warn('Telegram notification failed (assign_recommended manager)', err));

    this.webhooks
      .dispatch(user.establishment_id, 'order.assigned', { order_id: id })
      .catch((err) => this.logger.warn('webhook dispatch failed for order.assigned', err));

    // Set courier:active_order Redis key for public tracking
    const createdDelivery = await this.prisma.delivery.findFirst({
      where: { order_id: id },
      select: { id: true },
      orderBy: { assigned_at: 'desc' },
    });
    if (createdDelivery) {
      this.trackingService.setActiveOrder(
        courierId,
        id,
        createdDelivery.id,
        order.lat,
        order.lng,
        courier.transport_mode,
        establishment.lat,
        establishment.lng,
      ).catch((err) => this.logger.warn('setActiveOrder failed after assignRecommended', err));
    }

    // Publish delivery status for public WS
    this.redis.publish(
      PUBLIC_DELIVERY_STATUS_CHANNEL,
      JSON.stringify({ orderId: id, orderStatus: 'assigned', deliveryStatus: 'assigned' }),
    ).catch((err: unknown) => this.logger.warn('Redis publish failed (assign_recommended)', err));

    // Invalidate workload cache — fire-and-forget
    this.couriersService.invalidateWorkloadCache(user.establishment_id).catch((err) =>
      this.logger.warn('Failed to invalidate workload cache after assignRecommended', err),
    );

    return result;
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

  /**
   * Returns the delivery in 'assigned' state for the given order, or null if not found.
   * Used by the reassign controller to resolve delivery ID from order ID.
   */
  async findAssignedDelivery(
    orderId: string,
    establishmentId: string,
  ): Promise<{ id: string } | null> {
    // Verify order belongs to establishment first
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.establishment_id !== establishmentId) return null;

    return this.prisma.delivery.findFirst({
      where: { order_id: orderId, status: 'assigned' },
      select: { id: true },
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

  // ── Manual coordinate correction ─────────────────────────────────────────

  /**
   * Manager manually corrects order coordinates by dragging a pin on the map.
   * Publishes order:coords_ready to WS so all connected managers see the update in real time.
   * Returns a proximity_warning when the chosen coordinates are suspiciously far from the
   * establishment — the manager can override but should double-check before confirming.
   */
  async updateCoordinates(id: string, lat: number, lng: number, user: AuthenticatedUser) {
    this.assertManagerOrOwner(user);
    const order = await this.assertBelongs(id, user.establishment_id);

    const establishment = await this.prisma.establishment.findUnique({
      where: { id: user.establishment_id },
      select: { lat: true, lng: true, dispatch_mode: true },
    });

    let proximityWarning: string | undefined;
    if (establishment?.lat != null && establishment?.lng != null) {
      const distanceKm =
        haversineMeters(establishment.lat, establishment.lng, lat, lng) / 1000;
      if (distanceKm > 25) {
        proximityWarning = `Вказані координати знаходяться ${distanceKm.toFixed(0)} км від вашого закладу. Переконайтесь, що адреса правильна.`;
        this.logger.warn(
          `Manual coord update for order ${id}: ${distanceKm.toFixed(1)} km from establishment (${lat},${lng})`,
        );
      }
    }

    await this.prisma.order.update({
      where: { id },
      data: { lat, lng },
    });

    // Broadcast to all managers of this establishment so the dashboard updates in real time
    this.gateway.broadcastToEstablishment(user.establishment_id, 'order:coords_ready', {
      order_id: order.id,
      lat,
      lng,
    });

    // Re-trigger auto-dispatch if the order is still pending.
    // Covers the case where geocoding failed (address not found / proximity check rejected)
    // and the manager manually corrected the coordinates — without this, the order would
    // remain stuck in 'pending' forever in auto-dispatch mode.
    if (order.status === 'pending' && establishment?.dispatch_mode === 'auto') {
      this.dispatchQueue
        .add(
          { orderId: id, establishmentId: user.establishment_id, attempt: 1 },
          { jobId: `dispatch:${id}` },
        )
        .catch((err) =>
          this.logger.warn(`Failed to enqueue dispatch after manual coord update for order ${id}`, err),
        );
    }

    return { id, lat, lng, ...(proximityWarning ? { proximity_warning: proximityWarning } : {}) };
  }

  private assertManagerOrOwner(user: AuthenticatedUser): void {
    if (user.role !== 'owner' && user.role !== 'manager') {
      throw new ForbiddenException('Insufficient permissions');
    }
  }
}
