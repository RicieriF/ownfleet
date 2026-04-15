import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import * as crypto from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { WEBHOOK_QUEUE, WebhookJob } from './webhooks.service.js';

const DELIVERY_TIMEOUT_MS = 10_000; // 10 s per attempt

@Processor(WEBHOOK_QUEUE)
export class WebhookDispatchProcessor {
  private readonly logger = new Logger(WebhookDispatchProcessor.name);

  constructor(private readonly prisma: PrismaService) {}

  @Process('deliver')
  async handleDeliver(job: Job<WebhookJob>): Promise<void> {
    const { webhookId, event, payload } = job.data;

    const webhook = await this.prisma.webhook.findUnique({
      where: { id: webhookId },
    });
    if (!webhook || !webhook.active) {
      // Deleted or disabled since it was queued — skip silently
      return;
    }

    const body = JSON.stringify({
      event,
      payload,
      timestamp: new Date().toISOString(),
      webhook_id: webhookId,
      // Stable across all retry attempts of the same delivery — use for idempotency.
      event_id: String(job.id),
    });

    const signature = crypto
      .createHmac('sha256', webhook.secret)
      .update(body)
      .digest('hex');

    let response: Response;
    try {
      response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': `sha256=${signature}`,
          'X-Webhook-Event': event,
        },
        body,
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      });
    } catch (err: unknown) {
      // Network error / timeout — rethrow so Bull retries.
      // Increment consecutive_failures only on the final attempt.
      const message = err instanceof Error ? err.message : String(err);
      if (this.isFinalAttempt(job)) {
        await this.recordFailure(webhookId, `Network error: ${message}`);
      }
      throw err;
    }

    if (!response.ok) {
      const errorMsg = `HTTP ${response.status}`;
      // Increment consecutive_failures only on the final attempt.
      if (this.isFinalAttempt(job)) {
        await this.recordFailure(webhookId, errorMsg);
      }
      throw new Error(
        `Webhook delivery failed: ${errorMsg} for ${webhook.url}`,
      );
    }

    // ── Success ─────────────────────────────────────────────────────────
    await this.prisma.webhook.update({
      where: { id: webhookId },
      data: { consecutive_failures: 0, last_error: null, last_error_at: null },
    });

    this.logger.debug(
      `Delivered event "${event}" to ${webhook.url} [webhook: ${webhookId}]`,
    );
  }

  /**
   * Returns true when this is the last Bull retry for the job.
   * consecutive_failures should only be incremented once per delivery attempt,
   * not once per retry — matching industry standard (Stripe, GitHub Webhooks).
   *
   * Bull increments `attemptsMade` inside `moveToFailed()` (via `_saveAttempt`),
   * which runs AFTER the handler throws — not before. So when the handler is
   * executing its Nth attempt, `attemptsMade` equals N-1 (0-based).
   * For maxAttempts=5: final-attempt handler sees attemptsMade=4 → check is 4 >= 4.
   */
  private isFinalAttempt(job: Job): boolean {
    const maxAttempts = job.opts.attempts ?? 1;
    return job.attemptsMade >= maxAttempts - 1;
  }

  private async recordFailure(webhookId: string, error: string): Promise<void> {
    await this.prisma.webhook
      .update({
        where: { id: webhookId },
        data: {
          consecutive_failures: { increment: 1 },
          last_error: error,
          last_error_at: new Date(),
        },
      })
      .catch((e) =>
        this.logger.error(
          `Failed to record webhook failure for ${webhookId}`,
          e,
        ),
      );
  }
}
