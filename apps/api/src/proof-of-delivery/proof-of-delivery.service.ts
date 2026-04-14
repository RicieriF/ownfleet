import {
  ConflictException,
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
  Inject,
} from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ConfigService } from '@nestjs/config';
import type IORedis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { TelegramService } from '../telegram/telegram.service.js';
import { MANAGER_EVENT } from '../telegram/telegram.types.js';
import { AuthenticatedUser } from '../auth/auth.types.js';
import { CompleteDeliveryDto } from './dto/complete-delivery.dto.js';
import { assertDeliveryTransition } from '../orders/order-state-machine.js';
import { OrderStatus, DeliveryStatus, Prisma } from '@prisma/client';
import { REDIS_CLIENT, PUBLIC_DELIVERY_STATUS_CHANNEL, PUBLIC_DELIVERY_COMPLETED_CHANNEL } from '../shared/redis/redis.constants.js';

const GEO_RADIUS_METERS = 300;
const PRESIGNED_URL_TTL_SEC = 300; // 5 min

/**
 * Structured type for the `delivery_proofs.geo_flags` JSONB column.
 * All keys are optional — a flag is present only when the condition fired.
 * This type is the single source of truth; the DB column stores it as Json.
 */
export interface GeoFlags extends Record<string, unknown> {
  /** Proof was submitted after the POS order_closed_at timestamp */
  proof_after_close?: true;
  /** GPS accuracy was >100 m — reading may be imprecise */
  low_accuracy?: true;
  /** Order had no destination coordinates — 300 m check was skipped */
  no_destination_coords?: true;
  /** Delivery was closed by a manager without courier geo proof */
  force_closed?: true;
  /** Manager user id when force_closed=true */
  closed_by?: string;
}

@Injectable()
export class ProofOfDeliveryService {
  private readonly logger = new Logger(ProofOfDeliveryService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhooksService,
    private readonly telegram: TelegramService,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
  ) {
    this.s3 = new S3Client({
      endpoint: config.get<string>('S3_ENDPOINT'),
      region: 'auto',
      credentials: {
        accessKeyId: config.getOrThrow<string>('S3_ACCESS_KEY'),
        secretAccessKey: config.getOrThrow<string>('S3_SECRET_KEY'),
      },
    });
    this.bucket = config.getOrThrow<string>('S3_BUCKET');
  }

  async getMyDeliveryHistory(user: AuthenticatedUser, limit = 50) {
    if (!user.courier_id) {
      throw new ForbiddenException('Only courier accounts can access delivery history');
    }

    return this.prisma.delivery.findMany({
      where: {
        courier_id: user.courier_id,
        status: { in: [DeliveryStatus.completed, DeliveryStatus.failed] },
      },
      orderBy: { completed_at: 'desc' },
      take: limit,
      select: {
        id: true,
        status: true,
        assigned_at: true,
        started_at: true,
        completed_at: true,
        order: {
          select: {
            id: true,
            address: true,
            external_id: true,
          },
        },
      },
    });
  }

  async getActiveDelivery(user: AuthenticatedUser) {
    if (!user.courier_id) {
      throw new ForbiddenException('Only courier accounts can access active deliveries');
    }

    const delivery = await this.prisma.delivery.findFirst({
      where: {
        courier_id: user.courier_id,
        status: { in: [DeliveryStatus.assigned, DeliveryStatus.in_progress] },
      },
      include: {
        order: {
          select: {
            id: true,
            address: true,
            lat: true,
            lng: true,
            notes: true,
            status: true,
            external_id: true,
          },
        },
      },
    });

    return delivery ?? null;
  }

  async getUploadUrl(deliveryId: string, user: AuthenticatedUser): Promise<{ upload_url: string; photo_key: string }> {
    const delivery = await this.assertDeliveryBelongs(deliveryId, user.establishment_id);

    // Only active deliveries may receive uploads
    if (delivery.status !== DeliveryStatus.assigned && delivery.status !== DeliveryStatus.in_progress) {
      throw new BadRequestException('Upload URL can only be issued for active deliveries');
    }

    // Couriers may only get upload URLs for their own active delivery
    if (user.courier_id && delivery.courier_id !== user.courier_id) {
      throw new ForbiddenException('This delivery is not assigned to you');
    }

    const photoKey = `proofs/${user.establishment_id}/${deliveryId}/${Date.now()}.jpg`;
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: photoKey,
      ContentType: 'image/jpeg',
    });

    const upload_url = await getSignedUrl(this.s3, cmd, { expiresIn: PRESIGNED_URL_TTL_SEC });
    return { upload_url, photo_key: photoKey };
  }

  async startDelivery(deliveryId: string, user: AuthenticatedUser) {
    const delivery = await this.assertDeliveryBelongs(deliveryId, user.establishment_id);

    // Courier may only start their own delivery
    if (user.courier_id && delivery.courier_id !== user.courier_id) {
      throw new ForbiddenException('This delivery is not assigned to you');
    }

    assertDeliveryTransition(delivery.status, DeliveryStatus.in_progress);

    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      // Atomic conditional update — prevents double-start race condition.
      // If another request already transitioned this delivery, affected rows = 0.
      const updated = await tx.delivery.updateMany({
        where: { id: deliveryId, status: DeliveryStatus.assigned },
        data: { status: DeliveryStatus.in_progress, started_at: now },
      });
      if (updated.count === 0) {
        throw new ConflictException('Delivery was already started by another request');
      }
      await tx.order.update({
        where: { id: delivery.order_id },
        data: { status: OrderStatus.in_progress },
      });
    });

    // Publish delivery:status for public WS
    this.redis.publish(
      PUBLIC_DELIVERY_STATUS_CHANNEL,
      JSON.stringify({ orderId: delivery.order_id, orderStatus: 'in_progress', deliveryStatus: 'in_progress' }),
    ).catch((err: unknown) => this.logger.warn('Redis publish failed (delivery_in_progress)', err));

    // Return full delivery object so mobile can render InProgressState immediately
    return this.prisma.delivery.findUniqueOrThrow({
      where: { id: deliveryId },
      include: {
        order: {
          select: {
            id: true,
            address: true,
            lat: true,
            lng: true,
            notes: true,
            external_id: true,
          },
        },
      },
    });
  }

  async completeDelivery(
    deliveryId: string,
    dto: CompleteDeliveryDto,
    user: AuthenticatedUser,
  ) {
    // Only couriers may submit proof of delivery — managers use forceCloseDelivery
    if (!user.courier_id) {
      throw new ForbiddenException('Only couriers can complete deliveries with proof');
    }

    const delivery = await this.assertDeliveryBelongs(deliveryId, user.establishment_id);

    // Courier may only complete their own delivery
    if (delivery.courier_id !== user.courier_id) {
      throw new ForbiddenException('This delivery is not assigned to you');
    }

    assertDeliveryTransition(delivery.status, DeliveryStatus.completed);

    // Validate photo_key belongs to this delivery (prevents cross-delivery photo substitution)
    if (dto.photo_key && !dto.photo_key.startsWith(`proofs/${user.establishment_id}/${deliveryId}/`)) {
      throw new ForbiddenException('photo_key does not match this delivery');
    }

    // Fetch the order to get destination coordinates
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: delivery.order_id },
      select: { lat: true, lng: true },
    });

    const now = new Date();
    // captured_at is always set server-side — client clock is untrusted
    const capturedAt = now;

    // ── Geo flags ──────────────────────────────────────────────────────────
    const geoFlags: GeoFlags = {};

    // Two timestamps anomaly: proof captured AFTER order_closed_at
    // (order_closed_at is set when manager closes order in external POS)
    if (delivery.order_closed_at && capturedAt > delivery.order_closed_at) {
      geoFlags.proof_after_close = true;
    }

    // Accuracy flag — low accuracy GPS reading
    if (dto.accuracy && dto.accuracy > 100) {
      geoFlags.low_accuracy = true;
    }

    // ── 300m geo check via PostGIS ─────────────────────────────────────────
    let geoMatch = false;

    if (order.lat !== null && order.lng !== null) {
      const result = await this.prisma.$queryRaw<{ within: boolean }[]>`
        SELECT ST_DWithin(
          ST_SetSRID(ST_MakePoint(${dto.lng}, ${dto.lat}), 4326)::geography,
          ST_SetSRID(ST_MakePoint(${order.lng}, ${order.lat}), 4326)::geography,
          ${GEO_RADIUS_METERS}
        ) AS within
      `;
      geoMatch = result[0]?.within ?? false;
    } else {
      // No destination coordinates — cannot verify, mark as unverifiable
      geoFlags.no_destination_coords = true;
    }

    // ── Persist proof + update delivery/order atomically ──────────────────
    // delivery_proofs is NEVER deleted — no cascade, intentional
    // Atomic conditional update prevents double-completion race condition.
    await this.prisma.$transaction(async (tx) => {
      // Guard: only complete if still in_progress — prevents duplicate proof rows
      const updated = await tx.delivery.updateMany({
        where: { id: deliveryId, status: DeliveryStatus.in_progress },
        data: { status: DeliveryStatus.completed, completed_at: now },
      });
      if (updated.count === 0) {
        throw new ConflictException('Delivery was already completed by another request');
      }

      await tx.deliveryProof.create({
        data: {
          delivery_id: deliveryId,
          lat: dto.lat,
          lng: dto.lng,
          captured_at: capturedAt,
          order_closed_at: delivery.order_closed_at,
          photo_key: dto.photo_key ?? null,
          geo_match: geoMatch,
          accuracy: dto.accuracy ?? null,
          geo_flags: geoFlags as Prisma.InputJsonValue,
        },
      });

      await tx.order.update({
        where: { id: delivery.order_id },
        data: { status: OrderStatus.completed },
      });
    });

    // Delivery ALWAYS completes regardless of geo_match — it's audit info only
    this.webhooks
      .dispatch(user.establishment_id, 'delivery.completed', {
        delivery_id: deliveryId,
        order_id: delivery.order_id,
        geo_match: geoMatch,
      })
      .catch((err) => this.logger.warn('webhook dispatch failed for delivery.completed', err));

    this.telegram.notifyEstablishmentManagers(
      user.establishment_id,
      `✅ Доставку завершено ${geoMatch ? '(геопозиція OK)' : '(геопозиція не співпала)'}`,
      MANAGER_EVENT.DELIVERY_COMPLETED,
    ).catch((err: unknown) => this.logger.warn('Telegram notification failed (delivery_completed)', err));

    // Publish delivery:status for public WS (before lifecycle event so client sees completed first)
    this.redis.publish(
      PUBLIC_DELIVERY_STATUS_CHANNEL,
      JSON.stringify({ orderId: delivery.order_id, orderStatus: 'completed', deliveryStatus: 'completed' }),
    ).catch((err: unknown) => this.logger.warn('Failed to publish delivery:status (completed)', err));

    // Publish delivery:completed lifecycle event → PublicTrackingGateway shortens token TTL + schedules disconnect.
    // Fire-and-forget with fallback: if this publish fails, the token retains its 4h TTL
    // (vs. the intended 15 min post-delivery) and the WS room is not explicitly closed.
    // RetentionModule cleans up the token after the 4h TTL regardless.
    this.redis.publish(
      PUBLIC_DELIVERY_COMPLETED_CHANNEL,
      JSON.stringify({ orderId: delivery.order_id, deliveryId, courierId: delivery.courier_id }),
    ).catch((err: unknown) => this.logger.warn('Failed to publish delivery:completed — token TTL shortening skipped', err));

    // DEL Redis tracking keys — fire-and-forget
    this.redis.del(
      `courier:active_order:${delivery.courier_id}`,
      `route:origin:${deliveryId}`,
      `route:${deliveryId}`,
    ).catch((err: unknown) => this.logger.warn('Redis DEL failed for delivery tracking keys', err));

    return { status: DeliveryStatus.completed, geo_match: geoMatch, geo_flags: geoFlags };
  }

  /**
   * Manager/owner emergency close: completes delivery without geo proof.
   * Use when courier's phone died or other operational emergency.
   * Creates a delivery_proof with force_closed=true for full audit trail.
   */
  async forceCloseDelivery(deliveryId: string, user: AuthenticatedUser) {
    if (user.role !== 'owner' && user.role !== 'manager') {
      throw new ForbiddenException('Only managers and owners can force-close deliveries');
    }

    const delivery = await this.assertDeliveryBelongs(deliveryId, user.establishment_id);

    // Allow force-close from assigned or in_progress (courier may not have started)
    if (
      delivery.status !== DeliveryStatus.assigned &&
      delivery.status !== DeliveryStatus.in_progress
    ) {
      throw new BadRequestException(
        `Cannot force-close a delivery with status: ${delivery.status}`,
      );
    }

    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.delivery.updateMany({
        where: {
          id: deliveryId,
          status: { in: [DeliveryStatus.assigned, DeliveryStatus.in_progress] },
        },
        data: { status: DeliveryStatus.completed, completed_at: now },
      });
      if (updated.count === 0) {
        throw new ConflictException('Delivery was already closed by another request');
      }

      // Create proof for audit trail — force_closed marks it as manager-initiated
      const forceFlags: GeoFlags = { force_closed: true, closed_by: user.id };
      await tx.deliveryProof.create({
        data: {
          delivery_id: deliveryId,
          lat: 0,
          lng: 0,
          captured_at: now,
          order_closed_at: delivery.order_closed_at,
          photo_key: null,
          geo_match: false,
          accuracy: null,
          geo_flags: forceFlags as Prisma.InputJsonValue,
        },
      });

      await tx.order.update({
        where: { id: delivery.order_id },
        data: { status: OrderStatus.completed },
      });
    });

    this.webhooks
      .dispatch(user.establishment_id, 'delivery.completed', {
        delivery_id: deliveryId,
        order_id: delivery.order_id,
        geo_match: false,
        force_closed: true,
      })
      .catch((err) => this.logger.warn('webhook dispatch failed for delivery.completed (force-close)', err));

    this.telegram.notifyEstablishmentManagers(
      user.establishment_id,
      `⚠️ Доставку закрито вручну менеджером`,
      MANAGER_EVENT.DELIVERY_FORCE_CLOSED,
    ).catch((err: unknown) => this.logger.warn('Telegram notification failed (delivery_force_closed)', err));

    // Publish delivery:status + lifecycle events for public WS
    this.redis.publish(
      PUBLIC_DELIVERY_STATUS_CHANNEL,
      JSON.stringify({ orderId: delivery.order_id, orderStatus: 'completed', deliveryStatus: 'completed' }),
    ).catch(() => {});
    this.redis.publish(
      PUBLIC_DELIVERY_COMPLETED_CHANNEL,
      JSON.stringify({ orderId: delivery.order_id, deliveryId, courierId: delivery.courier_id }),
    ).catch(() => {});
    this.redis.del(
      `courier:active_order:${delivery.courier_id}`,
      `route:origin:${deliveryId}`,
      `route:${deliveryId}`,
    ).catch(() => {});

    return { status: DeliveryStatus.completed, force_closed: true };
  }

  async failDelivery(deliveryId: string, user: AuthenticatedUser) {
    const delivery = await this.assertDeliveryBelongs(deliveryId, user.establishment_id);

    // Courier may only fail their own delivery
    if (user.courier_id && delivery.courier_id !== user.courier_id) {
      throw new ForbiddenException('This delivery is not assigned to you');
    }

    assertDeliveryTransition(delivery.status, DeliveryStatus.failed);

    await this.prisma.$transaction(async (tx) => {
      // Atomic status guard: prevents double-fail race (pre-check is outside transaction).
      const updated = await tx.delivery.updateMany({
        where: { id: deliveryId, status: DeliveryStatus.in_progress },
        data: { status: DeliveryStatus.failed },
      });
      if (updated.count === 0) {
        throw new ConflictException('Delivery was already transitioned by another request');
      }
      await tx.order.update({
        where: { id: delivery.order_id },
        data: { status: OrderStatus.failed },
      });
    });

    this.webhooks
      .dispatch(user.establishment_id, 'delivery.failed', {
        delivery_id: deliveryId,
        order_id: delivery.order_id,
      })
      .catch((err) => this.logger.warn('webhook dispatch failed for delivery.failed', err));

    this.telegram.notifyEstablishmentManagers(
      user.establishment_id,
      `❌ Доставку провалено`,
      MANAGER_EVENT.DELIVERY_FAILED,
    ).catch((err: unknown) => this.logger.warn('Telegram notification failed (delivery_failed)', err));

    // Publish delivery:status for public WS + DEL Redis keys
    this.redis.publish(
      PUBLIC_DELIVERY_STATUS_CHANNEL,
      JSON.stringify({ orderId: delivery.order_id, orderStatus: 'failed', deliveryStatus: 'failed' }),
    ).catch((err: unknown) => this.logger.warn('Redis publish failed (delivery_failed)', err));
    this.redis.del(
      `courier:active_order:${delivery.courier_id}`,
      `route:origin:${deliveryId}`,
      `route:${deliveryId}`,
    ).catch(() => {});

    return { status: DeliveryStatus.failed };
  }

  /**
   * Manager: fetch delivery proof for a completed delivery.
   * Returns null when the delivery was never completed (no proof row exists).
   * photo_url is a short-lived presigned S3 URL (5 min TTL) when photo_key is set.
   */
  async getDeliveryProof(deliveryId: string, user: AuthenticatedUser) {
    await this.assertDeliveryBelongs(deliveryId, user.establishment_id);

    const proof = await this.prisma.deliveryProof.findFirst({
      where: { delivery_id: deliveryId },
      orderBy: { captured_at: 'desc' },
    });

    if (!proof) return null;

    let photo_url: string | null = null;
    if (proof.photo_key) {
      photo_url = await getSignedUrl(
        this.s3,
        new GetObjectCommand({ Bucket: this.bucket, Key: proof.photo_key }),
        { expiresIn: PRESIGNED_URL_TTL_SEC },
      );
    }

    return {
      id: proof.id,
      delivery_id: proof.delivery_id,
      lat: proof.lat,
      lng: proof.lng,
      captured_at: proof.captured_at,
      geo_match: proof.geo_match,
      accuracy: proof.accuracy,
      geo_flags: proof.geo_flags as GeoFlags,
      photo_key: proof.photo_key,
      photo_url,
    };
  }

  private async assertDeliveryBelongs(deliveryId: string, establishmentId: string) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      include: { order: { select: { establishment_id: true } } },
    });

    if (!delivery) throw new NotFoundException('Delivery not found');
    if (delivery.order.establishment_id !== establishmentId) {
      throw new ForbiddenException('Delivery does not belong to your establishment');
    }

    return delivery;
  }
}
