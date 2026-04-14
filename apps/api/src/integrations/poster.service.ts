import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { GeocodingService } from '../geocoding/geocoding.service.js';
import { TelegramService } from '../telegram/telegram.service.js';
import { MANAGER_EVENT } from '../telegram/telegram.types.js';
import { IntegrationType, OrderSource } from '@prisma/client';

interface PosterOrderPayload {
  object: string;            // 'incoming_order'
  object_id: string;         // external order id
  action: string;            // 'added' | 'changed'
  data: {
    phone?: string;
    address?: string;
    comment?: string;
    delivery?: Record<string, unknown>; // coords intentionally not read — always geocoded
  };
}

@Injectable()
export class PosterService {
  private readonly logger = new Logger(PosterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly geocodingService: GeocodingService,
    private readonly telegram: TelegramService,
  ) {}

  /**
   * Validates Poster HMAC signature and upserts the order.
   * Signature header: X-Poster-Signature = HMAC-SHA256(applicationSecret, rawBody)
   */
  async handleWebhook(
    establishmentId: string,
    rawBody: Buffer,
    signature: string | undefined,
  ): Promise<{ received: boolean; order_id?: string }> {
    const integration = await this.prisma.integration.findUnique({
      where: {
        establishment_id_type: {
          establishment_id: establishmentId,
          type: IntegrationType.poster,
        },
      },
    });

    if (!integration || !integration.active) {
      throw new UnauthorizedException('Poster integration not configured');
    }

    const config = integration.config as Record<string, unknown>;
    const secret = config['application_secret'] as string | undefined;

    if (!secret) {
      throw new UnauthorizedException('Poster integration secret not configured');
    }

    // ── HMAC verification ─────────────────────────────────────────────────
    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    const signatureBuffer = Buffer.from(signature ?? '', 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');

    if (
      signatureBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      this.logger.warn(`Invalid Poster HMAC for establishment ${establishmentId}`);
      throw new UnauthorizedException('Invalid webhook signature');
    }

    // ── Parse and upsert order ────────────────────────────────────────────
    let payload: PosterOrderPayload;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as PosterOrderPayload;
    } catch {
      this.logger.warn(`Poster webhook: invalid JSON for establishment ${establishmentId}`);
      return { received: true }; // accept but ignore malformed payloads
    }

    if (payload.object !== 'incoming_order' || payload.action !== 'added') {
      return { received: true }; // only interested in new delivery orders
    }

    const externalId = String(payload.object_id);
    const address = payload.data?.address ?? 'Unknown';
    const notes = payload.data?.comment ?? null;
    // POS-provided coordinates are intentionally ignored — Poster coordinates are often
    // inaccurate or missing (sentinel 0,0). We always geocode from the address string.

    // Idempotent: return existing if already ingested
    const existing = await this.prisma.order.findFirst({
      where: { external_id: externalId, establishment_id: establishmentId },
    });
    if (existing) return { received: true, order_id: existing.id };

    const order = await this.prisma.order.create({
      data: {
        establishment_id: establishmentId,
        external_id: externalId,
        address,
        lat: null,
        lng: null,
        notes,
        source: OrderSource.poster,
      },
    });

    this.logger.log(`Poster order ingested: ${order.id} (ext: ${externalId})`);

    if (address === 'Unknown') {
      // Cannot geocode — alert manager immediately so they can set coordinates manually
      void this.telegram
        .notifyEstablishmentManagers(
          establishmentId,
          `⚠️ Замовлення #${externalId} від Poster надійшло без адреси.\nВстановіть координати вручну через кнопку «Карта» у дашборді.`,
          MANAGER_EVENT.GEOCODE_FAILED,
        )
        .catch((err) => this.logger.warn(`Telegram alert failed for no-address Poster order ${order.id}`, err));
    } else {
      void this.geocodingService.enqueueGeocode(order.id, address, establishmentId);
    }

    return { received: true, order_id: order.id };
  }
}
