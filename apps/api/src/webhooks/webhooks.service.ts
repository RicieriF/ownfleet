import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthenticatedUser } from '../auth/auth.types.js';
import { CreateWebhookDto } from './dto/create-webhook.dto.js';
import { UpdateWebhookDto } from './dto/update-webhook.dto.js';

export const WEBHOOK_QUEUE = 'webhook-dispatch';

/**
 * Blocks SSRF via webhook URLs pointing to internal / link-local networks.
 * Covers: loopback, RFC-1918 private ranges, AWS/cloud metadata (169.254.x.x),
 * and IPv6 equivalents. Throws BadRequestException if the URL resolves to any
 * of these ranges — so the error surfaces cleanly at the API boundary.
 */
function assertNotInternalUrl(rawUrl: string): void {
  let hostname: string;
  try {
    hostname = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    // @IsUrl() in the DTO already rejects malformed URLs — this is a safety net.
    throw new BadRequestException('Invalid webhook URL');
  }

  // Strip IPv6 brackets: [::1] → ::1
  const host = hostname.replace(/^\[|\]$/g, '');

  const BLOCKED = [
    /^127\./, // loopback
    /^localhost$/, // loopback alias
    /^10\./, // RFC-1918 class A
    /^172\.(1[6-9]|2\d|3[01])\./, // RFC-1918 class B
    /^192\.168\./, // RFC-1918 class C
    /^169\.254\./, // link-local / cloud metadata (AWS, GCP, Azure)
    /^0\./, // "this" network
    /^(::1|::ffff:127\.|fc|fd)/, // IPv6 loopback + ULA
  ];

  if (BLOCKED.some((re) => re.test(host))) {
    throw new BadRequestException(
      'Webhook URL must not point to an internal address',
    );
  }
}

export interface WebhookJob {
  webhookId: string;
  event: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(WEBHOOK_QUEUE) private readonly queue: Queue<WebhookJob>,
  ) {}

  async create(dto: CreateWebhookDto, user: AuthenticatedUser) {
    this.assertManagerOrOwner(user);
    assertNotInternalUrl(dto.url);
    return this.prisma.webhook.create({
      data: {
        establishment_id: user.establishment_id,
        url: dto.url,
        secret: dto.secret,
        events: dto.events,
      },
    });
  }

  async findAll(user: AuthenticatedUser) {
    return this.prisma.webhook.findMany({
      where: { establishment_id: user.establishment_id },
      select: {
        id: true,
        establishment_id: true,
        url: true,
        events: true,
        active: true,
        consecutive_failures: true,
        last_error: true,
        last_error_at: true,
        created_at: true,
        updated_at: true,
        // secret intentionally excluded — write-only field
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async findOne(id: string, user: AuthenticatedUser) {
    return this.assertBelongs(id, user.establishment_id);
  }

  async update(id: string, dto: UpdateWebhookDto, user: AuthenticatedUser) {
    this.assertManagerOrOwner(user);
    if (dto.url !== undefined) assertNotInternalUrl(dto.url);
    await this.assertBelongs(id, user.establishment_id);
    return this.prisma.webhook.update({
      where: { id },
      data: {
        ...(dto.url !== undefined && { url: dto.url }),
        ...(dto.secret !== undefined && { secret: dto.secret }),
        ...(dto.events !== undefined && { events: dto.events }),
        ...(dto.active !== undefined && { active: dto.active }),
      },
    });
  }

  async remove(id: string, user: AuthenticatedUser) {
    this.assertManagerOrOwner(user);
    await this.assertBelongs(id, user.establishment_id);
    await this.prisma.webhook.delete({ where: { id } });
    return { deleted: true };
  }

  /**
   * Enqueues outbound webhook delivery for all active webhooks subscribed to the event.
   * Call fire-and-forget from other modules — never await at dispatch site.
   */
  async dispatch(
    establishmentId: string,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const webhooks = await this.prisma.webhook.findMany({
      where: {
        establishment_id: establishmentId,
        active: true,
        events: { has: event },
      },
      select: { id: true },
    });

    let queued = 0;
    for (const webhook of webhooks) {
      try {
        await this.queue.add(
          'deliver',
          { webhookId: webhook.id, event, payload },
          {
            attempts: 5,
            backoff: { type: 'exponential', delay: 1_000 },
            removeOnComplete: 100,
            removeOnFail: 50,
          },
        );
        queued++;
      } catch (err) {
        this.logger.warn(
          `Failed to enqueue webhook ${webhook.id} for event "${event}" — Redis may be unavailable`,
          err,
        );
      }
    }

    if (queued > 0) {
      this.logger.debug(
        `Queued ${queued}/${webhooks.length} webhook(s) for event "${event}" [est: ${establishmentId}]`,
      );
    }
  }

  private assertManagerOrOwner(user: AuthenticatedUser): void {
    if (user.role !== 'owner' && user.role !== 'manager') {
      throw new ForbiddenException(
        'Only owners and managers can manage webhooks',
      );
    }
  }

  private async assertBelongs(id: string, establishmentId: string) {
    const webhook = await this.prisma.webhook.findUnique({ where: { id } });
    if (!webhook) throw new NotFoundException('Webhook not found');
    if (webhook.establishment_id !== establishmentId) {
      throw new ForbiddenException(
        'Webhook does not belong to your establishment',
      );
    }
    return webhook;
  }
}
