import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthenticatedUser } from '../auth/auth.types.js';
import { CreateWebhookDto } from './dto/create-webhook.dto.js';
import { UpdateWebhookDto } from './dto/update-webhook.dto.js';

export const WEBHOOK_QUEUE = 'webhook-dispatch';

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

    for (const webhook of webhooks) {
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
    }

    if (webhooks.length > 0) {
      this.logger.debug(`Queued ${webhooks.length} webhook(s) for event "${event}" [est: ${establishmentId}]`);
    }
  }

  private async assertBelongs(id: string, establishmentId: string) {
    const webhook = await this.prisma.webhook.findUnique({ where: { id } });
    if (!webhook) throw new NotFoundException('Webhook not found');
    if (webhook.establishment_id !== establishmentId) {
      throw new ForbiddenException('Webhook does not belong to your establishment');
    }
    return webhook;
  }
}
