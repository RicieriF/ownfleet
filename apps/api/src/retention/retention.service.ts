import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { PrismaService } from '../prisma/prisma.service.js';
import { ShiftsService } from '../shifts/shifts.service.js';
import { EtaService } from '../eta/eta.service.js';
import { TelegramService } from '../telegram/telegram.service.js';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly shiftsService: ShiftsService,
    private readonly etaService: EtaService,
    private readonly telegram: TelegramService,
    @InjectQueue('dispatch') private readonly dispatchQueue: Queue,
  ) {}

  /**
   * Runs every 30 minutes.
   * Auto-closes shifts that have been active for 16+ hours without a GPS ping.
   */
  @Cron('0 */30 * * * *', { name: 'auto-close-stale-shifts', timeZone: 'UTC' })
  async autoCloseStaleShifts(): Promise<void> {
    const closed = await this.shiftsService.autoCloseStaleShifts();
    if (closed > 0) {
      this.logger.log(`Auto-close cron: closed ${closed} stale shift(s)`);
    }
  }

  /**
   * Runs every 5 minutes.
   * Sends Telegram notifications to couriers whose shift is ending soon
   * (based on planned_end_at and courier's configured threshold).
   */
  @Cron('0 */5 * * * *', { name: 'shift-ending-soon', timeZone: 'UTC' })
  async checkShiftEndingSoon(): Promise<void> {
    const sent = await this.shiftsService.checkShiftEndingSoon();
    if (sent > 0) {
      this.logger.log(`Shift ending soon: sent ${sent} notification(s)`);
    }
  }

  /**
   * Runs every 5 minutes.
   * Notifies managers when a courier stops sending GPS pings during an active delivery.
   */
  @Cron('0 */5 * * * *', { name: 'courier-not-responding', timeZone: 'UTC' })
  async checkCourierNotResponding(): Promise<void> {
    const sent = await this.shiftsService.checkCourierNotResponding();
    if (sent > 0) {
      this.logger.log(`Courier not responding: sent ${sent} notification(s)`);
    }
  }

  /**
   * Runs every 5 minutes.
   * Alerts managers via Telegram when a delivery has exceeded its ETA
   * beyond the establishment's configured delay threshold.
   */
  @Cron('0 */5 * * * *', { name: 'eta-overdue-alert', timeZone: 'UTC' })
  async checkEtaOverdue(): Promise<void> {
    const sent = await this.etaService.checkOverdueDeliveries();
    if (sent > 0) {
      this.logger.log(`ETA overdue: sent ${sent} alert(s)`);
    }
  }

  /**
   * Runs every 30 minutes.
   * Alerts managers via Telegram when a courier's delivery rate is significantly
   * higher than the establishment average (possible courier overload).
   * One alert per shift maximum (guarded by anomaly_alerted_at).
   */
  @Cron('0 */30 * * * *', { name: 'shift-anomaly-check', timeZone: 'UTC' })
  async checkShiftAnomalies(): Promise<void> {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

    // Only consider shifts that have been active long enough and have enough data
    const shifts = await this.prisma.shift.findMany({
      where: {
        ended_at: null,
        started_at: { lt: twoHoursAgo },
        anomaly_alerted_at: null,
        total_deliveries: { gt: 5 },
      },
      include: { courier: { select: { name: true } } },
    });

    for (const shift of shifts) {
      const hoursActive = (Date.now() - shift.started_at.getTime()) / (1000 * 60 * 60);
      const ratePerHour = shift.total_deliveries / hoursActive;

      // Get other active shifts in the same establishment for comparison
      const otherActiveShifts = await this.prisma.shift.findMany({
        where: {
          establishment_id: shift.establishment_id,
          ended_at: null,
          id: { not: shift.id },
          total_deliveries: { gt: 0 },
        },
      });

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
          .catch(() => {});
        await this.prisma.shift.update({
          where: { id: shift.id },
          data: { anomaly_alerted_at: new Date() },
        });
        this.logger.log(
          `Shift anomaly alert: courier ${shift.courier.name} (shift ${shift.id})`,
        );
      }
    }
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
          created_at: { lt: cutoff },
        },
        select: { id: true, establishment_id: true },
      });

      for (const order of staleOrders) {
        await this.dispatchQueue
          .add(
            { orderId: order.id, establishmentId: order.establishment_id, attempt: 1 },
            { jobId: `dispatch:${order.id}` },
          )
          .catch(() => {});
      }

      if (staleOrders.length > 0) {
        this.logger.log(
          `Recommend timeout: re-enqueued ${staleOrders.length} stale order(s) for establishment ${est.id}`,
        );
      }
    }
  }

  /**
   * Runs daily at 03:00 UTC.
   * Deletes old terminal orders and location_pings per establishment.
   * delivery_proofs are NEVER deleted — retention exempt by design.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'retention-cleanup', timeZone: 'UTC' })
  async runRetention(): Promise<void> {
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
