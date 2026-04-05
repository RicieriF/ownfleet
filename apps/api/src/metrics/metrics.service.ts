import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Cron } from '@nestjs/schedule';
import type { Queue } from 'bull';
import {
  collectDefaultMetrics,
  Histogram,
  Gauge,
  Registry,
  register as globalRegistry,
} from 'prom-client';
import { PING_PERSIST_QUEUE } from '../tracking/tracking.service.js';
import { WEBHOOK_QUEUE } from '../webhooks/webhooks.service.js';
import { GEOCODING_QUEUE } from '../geocoding/geocoding.constants.js';
import { TRACKING_DISCONNECT_QUEUE } from '../public-tracking/public-tracking.constants.js';

const DISPATCH_QUEUE = 'dispatch';

const MONITORED_QUEUES = [
  PING_PERSIST_QUEUE,
  WEBHOOK_QUEUE,
  DISPATCH_QUEUE,
  GEOCODING_QUEUE,
  TRACKING_DISCONNECT_QUEUE,
] as const;

@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly logger = new Logger(MetricsService.name);
  readonly registry: Registry = globalRegistry;

  private httpDuration!: Histogram<string>;
  private queueDepth!: Gauge<string>;

  constructor(
    @InjectQueue(PING_PERSIST_QUEUE) private readonly pingQueue: Queue,
    @InjectQueue(WEBHOOK_QUEUE) private readonly webhookQueue: Queue,
    @InjectQueue(DISPATCH_QUEUE) private readonly dispatchQueue: Queue,
    @InjectQueue(GEOCODING_QUEUE) private readonly geocodingQueue: Queue,
    @InjectQueue(TRACKING_DISCONNECT_QUEUE) private readonly trackingDisconnectQueue: Queue,
  ) {}

  onModuleInit(): void {
    // collectDefaultMetrics registers Node.js process metrics:
    // event loop lag, heap memory, GC stats, CPU usage, file descriptors, etc.
    collectDefaultMetrics({ register: this.registry });

    this.httpDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status_code'],
      // Buckets tuned for a delivery API: most responses expected under 500ms,
      // OSRM/geocoding calls may reach 2–5s.
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });

    this.queueDepth = new Gauge({
      name: 'bull_queue_depth',
      help: 'Number of Bull jobs by queue and state (waiting/active/failed/delayed)',
      labelNames: ['queue', 'state'],
      registers: [this.registry],
    });
  }

  /**
   * Called by MetricsInterceptor for every HTTP request.
   * durationMs is wall-clock time from first byte received to response flushed.
   */
  observeRequest(method: string, route: string, statusCode: number, durationMs: number): void {
    this.httpDuration.observe(
      { method, route, status_code: String(statusCode) },
      durationMs / 1000,
    );
  }

  /**
   * Updates queue depth gauges every 30 seconds.
   * Non-critical: a missed tick leaves stale values, not a missing data point.
   */
  @Cron('*/30 * * * * *')
  async updateQueueMetrics(): Promise<void> {
    const queues: Array<[string, Queue]> = [
      [PING_PERSIST_QUEUE, this.pingQueue],
      [WEBHOOK_QUEUE, this.webhookQueue],
      [DISPATCH_QUEUE, this.dispatchQueue],
      [GEOCODING_QUEUE, this.geocodingQueue],
      [TRACKING_DISCONNECT_QUEUE, this.trackingDisconnectQueue],
    ];

    await Promise.all(
      queues.map(async ([name, queue]) => {
        try {
          const counts = await queue.getJobCounts();
          for (const [state, count] of Object.entries(counts)) {
            this.queueDepth.set({ queue: name, state }, count);
          }
        } catch {
          // Non-fatal: stale gauge values are acceptable, log only at debug level
          this.logger.debug(`Failed to fetch job counts for queue "${name}"`);
        }
      }),
    );
  }

  async getMetricsText(): Promise<string> {
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }

  /** Exposed for testing — list of all monitored queue names. */
  static get queueNames(): readonly string[] {
    return MONITORED_QUEUES;
  }
}
