import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { AuthenticatedUser } from '../auth/auth.types.js';
import { CompleteDeliveryDto } from './dto/complete-delivery.dto.js';
import { assertDeliveryTransition } from '../orders/order-state-machine.js';
import { OrderStatus, DeliveryStatus } from '@prisma/client';

const GEO_RADIUS_METERS = 300;
const PRESIGNED_URL_TTL_SEC = 300; // 5 min

@Injectable()
export class ProofOfDeliveryService {
  private readonly logger = new Logger(ProofOfDeliveryService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhooksService,
    private readonly config: ConfigService,
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
    assertDeliveryTransition(delivery.status, DeliveryStatus.in_progress);

    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.delivery.update({
        where: { id: deliveryId },
        data: { status: DeliveryStatus.in_progress, started_at: now },
      });
      await tx.order.update({
        where: { id: delivery.order_id },
        data: { status: OrderStatus.in_progress },
      });
    });

    return { status: DeliveryStatus.in_progress, started_at: now };
  }

  async completeDelivery(
    deliveryId: string,
    dto: CompleteDeliveryDto,
    user: AuthenticatedUser,
  ) {
    const delivery = await this.assertDeliveryBelongs(deliveryId, user.establishment_id);
    assertDeliveryTransition(delivery.status, DeliveryStatus.completed);

    // Fetch the order to get destination coordinates
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: delivery.order_id },
      select: { lat: true, lng: true },
    });

    const now = new Date();
    const capturedAt = dto.captured_at ? new Date(dto.captured_at) : now;

    // ── Geo flags ──────────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geoFlags: Record<string, any> = {};

    // Two timestamps anomaly: proof captured AFTER order_closed_at
    // (order_closed_at is set when manager closes order in external POS)
    if (delivery.order_closed_at && capturedAt > delivery.order_closed_at) {
      geoFlags['proof_after_close'] = true;
    }

    // Accuracy flag — low accuracy GPS reading
    if (dto.accuracy && dto.accuracy > 100) {
      geoFlags['low_accuracy'] = true;
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
      geoFlags['no_destination_coords'] = true;
    }

    // ── Persist proof + update delivery/order atomically ──────────────────
    // delivery_proofs is NEVER deleted — no cascade, intentional
    await this.prisma.$transaction(async (tx) => {
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
          geo_flags: geoFlags,
        },
      });

      await tx.delivery.update({
        where: { id: deliveryId },
        data: { status: DeliveryStatus.completed, completed_at: now },
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

    return { status: DeliveryStatus.completed, geo_match: geoMatch, geo_flags: geoFlags };
  }

  async failDelivery(deliveryId: string, user: AuthenticatedUser) {
    const delivery = await this.assertDeliveryBelongs(deliveryId, user.establishment_id);
    assertDeliveryTransition(delivery.status, DeliveryStatus.failed);

    await this.prisma.$transaction(async (tx) => {
      await tx.delivery.update({
        where: { id: deliveryId },
        data: { status: DeliveryStatus.failed },
      });
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

    return { status: DeliveryStatus.failed };
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
