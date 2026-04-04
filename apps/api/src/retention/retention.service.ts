import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { gzipSync } from 'node:zlib';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { ShiftsService } from '../shifts/shifts.service.js';
import { EtaService } from '../eta/eta.service.js';
import { TelegramService } from '../telegram/telegram.service.js';
import { DistributedLockService } from '../shared/redis/distributed-lock.service.js';
import { OrderStatus } from '@prisma/client';

const DEFAULT_RETENTION_DAYS = 90;
// Orders must be in a terminal state to be eligible for deletion
const TERMINAL_STATUSES: OrderStatus[] = [
  OrderStatus.completed,
  OrderStatus.cancelled,
  OrderStatus.failed,
];

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);
  private readonly backupS3: S3Client | null;
  private readonly backupBucket: string | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly shiftsService: ShiftsService,
    private readonly etaService: EtaService,
    private readonly telegram: TelegramService,
    private readonly lock: DistributedLockService,
    private readonly config: ConfigService,
    @InjectQueue('dispatch') private readonly dispatchQueue: Queue,
  ) {
    const endpoint = config.get<string>('BACKUP_S3_ENDPOINT');
    const accessKeyId = config.get<string>('BACKUP_S3_ACCESS_KEY');
    const secretAccessKey = config.get<string>('BACKUP_S3_SECRET_KEY');
    const bucket = config.get<string>('BACKUP_S3_BUCKET');

    if (endpoint && accessKeyId && secretAccessKey && bucket) {
      this.backupS3 = new S3Client({
        endpoint,
        region: 'auto',
        credentials: { accessKeyId, secretAccessKey },
      });
      this.backupBucket = bucket;
    } else {
      this.backupS3 = null;
      this.backupBucket = null;
      this.logger.warn('Backup S3 not configured — weekly delivery_proofs export disabled');
    }
  }

  /**
   * Runs every 30 minutes.
   * Auto-closes shifts that have been active for 16+ hours without a GPS ping.
   */
  @Cron('0 */30 * * * *', { name: 'auto-close-stale-shifts', timeZone: 'UTC' })
  async autoCloseStaleShifts(): Promise<void> {
    await this.lock.withLock('auto-close-stale-shifts', 1500, async () => {
      const closed = await this.shiftsService.autoCloseStaleShifts();
      if (closed > 0) {
        this.logger.log(`Auto-close cron: closed ${closed} stale shift(s)`);
      }
    });
  }

  /**
   * Runs every 5 minutes.
   * Sends Telegram notifications to couriers whose shift is ending soon
   * (based on planned_end_at and courier's configured threshold).
   */
  @Cron('0 */5 * * * *', { name: 'shift-ending-soon', timeZone: 'UTC' })
  async checkShiftEndingSoon(): Promise<void> {
    await this.lock.withLock('shift-ending-soon', 240, async () => {
      const sent = await this.shiftsService.checkShiftEndingSoon();
      if (sent > 0) {
        this.logger.log(`Shift ending soon: sent ${sent} notification(s)`);
      }
    });
  }

  /**
   * Runs every 5 minutes.
   * Notifies managers when a courier stops sending GPS pings during an active delivery.
   */
  @Cron('0 */5 * * * *', { name: 'courier-not-responding', timeZone: 'UTC' })
  async checkCourierNotResponding(): Promise<void> {
    await this.lock.withLock('courier-not-responding', 240, async () => {
      const sent = await this.shiftsService.checkCourierNotResponding();
      if (sent > 0) {
        this.logger.log(`Courier not responding: sent ${sent} notification(s)`);
      }
    });
  }

  /**
   * Runs every 5 minutes.
   * Alerts managers via Telegram when a delivery has exceeded its ETA
   * beyond the establishment's configured delay threshold.
   */
  @Cron('0 */5 * * * *', { name: 'eta-overdue-alert', timeZone: 'UTC' })
  async checkEtaOverdue(): Promise<void> {
    await this.lock.withLock('eta-overdue-alert', 240, async () => {
      const sent = await this.etaService.checkOverdueDeliveries();
      if (sent > 0) {
        this.logger.log(`ETA overdue: sent ${sent} alert(s)`);
      }
    });
  }

  /**
   * Runs every 30 minutes.
   * Alerts managers via Telegram when a courier's delivery rate is significantly
   * higher than the establishment average (possible courier overload).
   * One alert per shift maximum (guarded by anomaly_alerted_at).
   */
  @Cron('0 */30 * * * *', { name: 'shift-anomaly-check', timeZone: 'UTC' })
  async checkShiftAnomalies(): Promise<void> {
    await this.lock.withLock('shift-anomaly-check', 1500, async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

    // Fetch all active shifts (candidate + comparison pool) in a single query
    const allActiveShifts = await this.prisma.shift.findMany({
      where: { ended_at: null, started_at: { lt: twoHoursAgo } },
      include: { courier: { select: { name: true } } },
    });

    // Group by establishment for O(1) comparison lookups
    const byEstablishment = new Map<string, typeof allActiveShifts>();
    for (const s of allActiveShifts) {
      const list = byEstablishment.get(s.establishment_id) ?? [];
      list.push(s);
      byEstablishment.set(s.establishment_id, list);
    }

    // Only consider shifts that need an alert and have enough data
    const candidates = allActiveShifts.filter(
      (s) => s.anomaly_alerted_at === null && s.total_deliveries > 5,
    );

    for (const shift of candidates) {
      const hoursActive = (Date.now() - shift.started_at.getTime()) / (1000 * 60 * 60);
      const ratePerHour = shift.total_deliveries / hoursActive;

      const otherActiveShifts = (byEstablishment.get(shift.establishment_id) ?? []).filter(
        (s) => s.id !== shift.id && s.total_deliveries > 0,
      );

      if (otherActiveShifts.length === 0) continue; // Cannot compare without others

      const avgRate =
        otherActiveShifts.reduce((sum, s) => {
          const hrs = (Date.now() - s.started_at.getTime()) / (1000 * 60 * 60);
          return sum + s.total_deliveries / Math.max(hrs, 0.5);
        }, 0) / otherActiveShifts.length;

      if (avgRate > 0 && ratePerHour > 2 * avgRate) {
        const msg = `⚠️ ${shift.courier.name}: ${shift.total_deliveries} доставок за ${hoursActive.toFixed(1)} год — у ${(ratePerHour / avgRate).toFixed(1)}x більше за середнє по команді`;
        this.telegram
          .notifyEstablishmentManagers(shift.establishment_id, msg, 'shift_anomaly')
          .catch((err: unknown) => this.logger.warn('Telegram notification failed (shift_anomaly)', err));
        await this.prisma.shift.update({
          where: { id: shift.id },
          data: { anomaly_alerted_at: new Date() },
        });
        this.logger.log(
          `Shift anomaly alert: courier ${shift.courier.name} (shift ${shift.id})`,
        );
      }
    }
    });
  }

  /**
   * Runs every 5 minutes.
   * In `recommend` dispatch mode, re-enqueues pending orders that have been
   * waiting longer than the establishment's configured timeout, so the algorithm
   * can pick the next best available courier.
   */
  @Cron('0 */5 * * * *', { name: 'recommend-timeout-check', timeZone: 'UTC' })
  async checkRecommendTimeout(): Promise<void> {
    const establishments = await this.prisma.establishment.findMany({
      where: { dispatch_mode: 'recommend' },
      select: { id: true, settings: true },
    });

    for (const est of establishments) {
      const settings = est.settings as Record<string, unknown>;
      const timeoutMinutes = settings?.dispatch_recommend_timeout_minutes as number | undefined;
      if (!timeoutMinutes) continue;

      const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000);
      const staleOrders = await this.prisma.order.findMany({
        where: {
          establishment_id: est.id,
          status: 'pending',
          // ready_at: when the order was marked ready (POST /ready).
          // Using ready_at — not created_at — so the timeout starts when
          // the kitchen finished, not when the order arrived in the system.
          // Orders without ready_at have not been dispatched yet — skip them.
          ready_at: { not: null, lt: cutoff },
        },
        select: { id: true, establishment_id: true },
      });

      for (const order of staleOrders) {
        // attempt: 1 is intentional — this cron starts a fresh dispatch wave,
        // not a retry of a prior wave. The processor's 30-attempt cap applies
        // within each wave. Escalation for persistently unassigned orders is
        // handled separately via dispatch_no_courier_escalation_minutes (planned).
        await this.dispatchQueue
          .add(
            { orderId: order.id, establishmentId: order.establishment_id, attempt: 1 },
            { jobId: `dispatch:${order.id}` },
          )
          .catch((err: unknown) =>
            this.logger.warn(`Failed to re-enqueue stale order ${order.id}`, err),
          );
      }

      if (staleOrders.length > 0) {
        this.logger.log(
          `Recommend timeout: re-enqueued ${staleOrders.length} stale order(s) for establishment ${est.id}`,
        );
      }
    }
  }

  /**
   * Runs every 30 minutes.
   * Deletes expired tracking_tokens (expires_at < NOW()).
   * Simple DELETE — no JOIN needed, no establishment_id.
   * delivery_proofs are never deleted regardless.
   */
  @Cron('0 */30 * * * *', { name: 'tracking-tokens-cleanup', timeZone: 'UTC' })
  async cleanupExpiredTrackingTokens(): Promise<void> {
    const result = await this.prisma.$executeRaw`
      DELETE FROM tracking_tokens WHERE expires_at < NOW()
    `;
    if ((result as number) > 0) {
      this.logger.log(`Tracking tokens cleanup: deleted ${result as number} expired token(s)`);
    }
  }

  /**
   * Runs daily at 03:00 UTC.
   * Deletes old terminal orders and location_pings per establishment.
   * delivery_proofs are NEVER deleted — retention exempt by design.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'retention-cleanup', timeZone: 'UTC' })
  async runRetention(): Promise<void> {
    await this.lock.withLock('retention-cleanup', 7200, async () => {
      this.logger.log('Starting retention cleanup');

      const PAGE_SIZE = 100;
      let cursor: string | undefined;
      let totalOrders = 0;
      let totalPings = 0;
      let totalEstablishments = 0;

      // Process establishments in pages to avoid loading all rows into memory
      do {
        const page = await this.prisma.establishment.findMany({
          select: { id: true, settings: true },
          take: PAGE_SIZE,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
          orderBy: { id: 'asc' },
        });

        if (page.length === 0) break;
        cursor = page[page.length - 1].id;
        totalEstablishments += page.length;

        for (const est of page) {
          const { deletedOrders, deletedPings } = await this.cleanupEstablishment(est.id, est.settings);
          totalOrders += deletedOrders;
          totalPings += deletedPings;
        }
      } while (true);

      this.logger.log(
        `Retention done — deleted ${totalOrders} orders, ${totalPings} location_pings across ${totalEstablishments} establishments`,
      );
    });
  }

  /**
   * Per-establishment cleanup. Public so it can be triggered manually in tests or admin tooling.
   */
  async cleanupEstablishment(
    establishmentId: string,
    settings: unknown,
  ): Promise<{ deletedOrders: number; deletedPings: number }> {
    const retentionDays = this.parseRetentionDays(settings);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    let deletedOrders = 0;
    let deletedPings = 0;

    try {
      // Delete terminal orders older than cutoff.
      // Cascades: deliveries (not delivery_proofs — no cascade on proofs by design).
      const ordersResult = await this.prisma.order.deleteMany({
        where: {
          establishment_id: establishmentId,
          status: { in: TERMINAL_STATUSES },
          created_at: { lt: cutoff },
        },
      });
      deletedOrders = ordersResult.count;

      // Delete location_pings older than cutoff for couriers of this establishment.
      const deletedPingsResult = await this.prisma.$executeRaw`
        DELETE FROM location_pings
        WHERE courier_id IN (
          SELECT id FROM couriers WHERE establishment_id = ${establishmentId}
        )
        AND created_at < ${cutoff}
      `;
      deletedPings = deletedPingsResult as number;

      if (deletedOrders > 0 || deletedPings > 0) {
        await this.prisma.retentionLog.create({
          data: {
            establishment_id: establishmentId,
            deleted_orders: deletedOrders,
            deleted_pings: deletedPings,
          },
        });

        this.logger.debug(
          `[${establishmentId}] deleted ${deletedOrders} orders, ${deletedPings} pings (cutoff: ${cutoff.toISOString()})`,
        );
      }
    } catch (err) {
      this.logger.error(`Retention failed for establishment ${establishmentId}`, err);
    }

    return { deletedOrders, deletedPings };
  }

  /**
   * Runs every Sunday at 02:00 UTC.
   * Exports delivery_proofs captured in the last 7 days to off-platform S3 storage.
   * delivery_proofs are never deleted by retention — this cron provides an extra
   * off-platform copy that survives provider-side incidents (legal evidence safety net).
   *
   * Skipped gracefully when BACKUP_S3_* env vars are not configured.
   */
  @Cron('0 2 * * 0', { name: 'weekly-delivery-proofs-backup', timeZone: 'UTC' })
  async weeklyDeliveryProofsBackup(): Promise<void> {
    if (!this.backupS3 || !this.backupBucket) {
      return;
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    try {
      const proofs = await this.prisma.deliveryProof.findMany({
        where: { created_at: { gte: sevenDaysAgo } },
        orderBy: { created_at: 'asc' },
      });

      const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const payload = gzipSync(Buffer.from(JSON.stringify(proofs)));

      await this.backupS3.send(
        new PutObjectCommand({
          Bucket: this.backupBucket,
          Key: `delivery-proofs/${dateStr}.json.gz`,
          Body: payload,
          ContentType: 'application/gzip',
        }),
      );

      this.logger.log(`Weekly backup completed: ${proofs.length} delivery_proofs → delivery-proofs/${dateStr}.json.gz`);
    } catch (err) {
      this.logger.error('Weekly delivery_proofs backup FAILED', err);
    }
  }

  private parseRetentionDays(settings: unknown): number {
    if (
      settings !== null &&
      typeof settings === 'object' &&
      'retention_days' in settings &&
      typeof (settings as Record<string, unknown>).retention_days === 'number'
    ) {
      const days = (settings as Record<string, unknown>).retention_days as number;
      return days > 0 ? days : DEFAULT_RETENTION_DAYS;
    }
    return DEFAULT_RETENTION_DAYS;
  }
}
