import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { ShiftsService } from '../shifts/shifts.service.js';
import { EtaService } from '../eta/eta.service.js';
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
