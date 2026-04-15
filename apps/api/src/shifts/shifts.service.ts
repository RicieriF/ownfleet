import {
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DeliveryStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TrackingGateway } from '../tracking/tracking.gateway';
import { TelegramService } from '../telegram/telegram.service.js';
import {
  CourierTelegramPrefs,
  MANAGER_EVENT,
} from '../telegram/telegram.types.js';
import { parseEstablishmentSettings } from '../establishments/establishment-settings.js';
import { StartShiftDto } from './dto/start-shift.dto';
import { UpdatePlannedEndDto } from './dto/update-planned-end.dto';
import { AuthenticatedUser } from '../auth/auth.types';

@Injectable()
export class ShiftsService {
  private readonly logger = new Logger(ShiftsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: TrackingGateway,
    private readonly telegram: TelegramService,
  ) {}

  // ── Courier: start shift ──────────────────────────────────────────────────

  async startShift(user: AuthenticatedUser, dto: StartShiftDto) {
    if (!user.courier_id) {
      throw new UnprocessableEntityException(
        'User is not linked to a courier profile',
      );
    }

    const existing = await this.prisma.shift.findFirst({
      where: { courier_id: user.courier_id, ended_at: null },
    });
    if (existing) {
      throw new ConflictException('Courier already has an active shift');
    }

    const shift = await this.prisma.shift.create({
      data: {
        courier_id: user.courier_id,
        establishment_id: user.establishment_id,
        planned_end_at: dto.planned_end_at
          ? new Date(dto.planned_end_at)
          : null,
      },
      include: { courier: { select: { name: true } } },
    });

    this.logger.log(
      `Shift started: courier=${user.courier_id} shift=${shift.id}`,
    );
    this.gateway.broadcastToEstablishment(
      user.establishment_id,
      'shift:started',
      {
        shift_id: shift.id,
        courier_id: shift.courier_id,
        started_at: shift.started_at,
        planned_end_at: shift.planned_end_at,
      },
    );
    this.telegram
      .notifyEstablishmentManagers(
        user.establishment_id,
        `🟢 ${shift.courier.name} вийшов на зміну`,
        MANAGER_EVENT.COURIER_SHIFT_STARTED,
      )
      .catch((err: unknown) =>
        this.logger.warn('Telegram notification failed (shift_started)', err),
      );
    return shift;
  }

  // ── Courier: end own shift ────────────────────────────────────────────────

  async endShift(user: AuthenticatedUser) {
    if (!user.courier_id) {
      throw new UnprocessableEntityException(
        'User is not linked to a courier profile',
      );
    }

    const shift = await this.prisma.shift.findFirst({
      where: { courier_id: user.courier_id, ended_at: null },
      include: { courier: { select: { name: true } } },
    });
    if (!shift) {
      throw new NotFoundException('No active shift found');
    }

    const updated = await this.prisma.shift.update({
      where: { id: shift.id },
      data: { ended_at: new Date(), ended_by: 'courier' },
    });

    this.logger.log(`Shift ended by courier: shift=${shift.id}`);
    this.gateway.broadcastToEstablishment(
      updated.establishment_id,
      'shift:ended',
      {
        shift_id: updated.id,
        courier_id: updated.courier_id,
        ended_by: 'courier',
        ended_at: updated.ended_at,
      },
    );
    this.telegram
      .notifyEstablishmentManagers(
        updated.establishment_id,
        `⚫ ${shift.courier.name} завершив зміну`,
        MANAGER_EVENT.COURIER_SHIFT_ENDED,
      )
      .catch((err: unknown) =>
        this.logger.warn(
          'Telegram notification failed (shift_ended_by_courier)',
          err,
        ),
      );
    return updated;
  }

  // ── Courier: get own active shift ─────────────────────────────────────────

  async getMyActiveShift(user: AuthenticatedUser) {
    if (!user.courier_id) return null;

    const shift = await this.prisma.shift.findFirst({
      where: { courier_id: user.courier_id, ended_at: null },
    });
    return shift ?? null;
  }

  // ── Manager: end any courier shift ───────────────────────────────────────

  async endShiftByManager(shiftId: string, user: AuthenticatedUser) {
    if (
      user.role !== 'manager' &&
      user.role !== 'owner' &&
      !user.is_platform_admin
    ) {
      throw new ForbiddenException(
        "Only managers and owners can end other couriers' shifts",
      );
    }

    const shift = await this.prisma.shift.findFirst({
      where: { id: shiftId, establishment_id: user.establishment_id },
      include: { courier: { select: { name: true } } },
    });
    if (!shift) throw new NotFoundException('Shift not found');
    if (shift.ended_at) throw new ConflictException('Shift is already ended');

    const updated = await this.prisma.shift.update({
      where: { id: shiftId },
      data: { ended_at: new Date(), ended_by: 'manager' },
    });

    this.logger.log(`Shift ended by manager: shift=${shiftId}`);
    this.gateway.broadcastToEstablishment(
      updated.establishment_id,
      'shift:ended',
      {
        shift_id: updated.id,
        courier_id: updated.courier_id,
        ended_by: 'manager',
        ended_at: updated.ended_at,
      },
    );
    this.telegram
      .notifyEstablishmentManagers(
        updated.establishment_id,
        `⚫ ${shift.courier.name} — зміну завершено менеджером`,
        MANAGER_EVENT.COURIER_SHIFT_ENDED,
      )
      .catch((err: unknown) =>
        this.logger.warn(
          'Telegram notification failed (shift_ended_by_manager)',
          err,
        ),
      );
    return updated;
  }

  // ── Manager: update planned_end_at ────────────────────────────────────────

  async updatePlannedEnd(
    shiftId: string,
    user: AuthenticatedUser,
    dto: UpdatePlannedEndDto,
  ) {
    if (
      user.role !== 'manager' &&
      user.role !== 'owner' &&
      !user.is_platform_admin
    ) {
      throw new ForbiddenException(
        'Only managers and owners can update planned end time',
      );
    }

    const shift = await this.prisma.shift.findFirst({
      where: {
        id: shiftId,
        establishment_id: user.establishment_id,
        ended_at: null,
      },
    });
    if (!shift) throw new NotFoundException('Active shift not found');

    return this.prisma.shift.update({
      where: { id: shiftId },
      data: {
        planned_end_at: dto.planned_end_at
          ? new Date(dto.planned_end_at)
          : null,
      },
    });
  }

  // ── Manager: get all active shifts for establishment ─────────────────────

  async getActiveShiftsForEstablishment(user: AuthenticatedUser) {
    if (
      user.role !== 'manager' &&
      user.role !== 'owner' &&
      !user.is_platform_admin
    ) {
      throw new ForbiddenException(
        'Only managers and owners can view all active shifts',
      );
    }

    return this.prisma.shift.findMany({
      where: { establishment_id: user.establishment_id, ended_at: null },
      include: {
        courier: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { started_at: 'asc' },
    });
  }

  // ── Courier: get own shift history ───────────────────────────────────────

  async getMyShiftHistory(user: AuthenticatedUser) {
    if (!user.courier_id) return [];

    return this.prisma.shift.findMany({
      where: { courier_id: user.courier_id, ended_at: { not: null } },
      select: {
        id: true,
        started_at: true,
        ended_at: true,
        ended_by: true,
        planned_end_at: true,
        total_deliveries: true,
        total_distance_km: true,
      },
      orderBy: { started_at: 'desc' },
      take: 60,
    });
  }

  // ── Internal: check active shift for a courier (used by ShiftActiveGuard) ─

  async hasActiveShift(courierId: string): Promise<boolean> {
    const shift = await this.prisma.shift.findFirst({
      where: { courier_id: courierId, ended_at: null },
      select: { id: true },
    });
    return shift !== null;
  }

  // ── Internal: auto-close stale shifts (called by RetentionModule cron) ───

  async autoCloseStaleShifts(): Promise<number> {
    const cutoff = new Date(Date.now() - 16 * 60 * 60 * 1000);

    const staleShifts = await this.prisma.$queryRaw<
      { id: string; courier_id: string; establishment_id: string }[]
    >`
      SELECT s.id, s.courier_id, s.establishment_id
      FROM shifts s
      WHERE s.ended_at IS NULL
        AND s.started_at < ${cutoff}
        AND NOT EXISTS (
          SELECT 1 FROM location_pings lp
          WHERE lp.courier_id = s.courier_id
            AND lp.created_at > ${cutoff}
        )
    `;

    if (staleShifts.length === 0) return 0;

    const endedAt = new Date();
    await this.prisma.shift.updateMany({
      where: { id: { in: staleShifts.map((s) => s.id) } },
      data: { ended_at: endedAt, ended_by: 'auto' },
    });

    const courierIds = staleShifts.map((s) => s.courier_id);
    const couriers = await this.prisma.courier.findMany({
      where: { id: { in: courierIds } },
      select: { id: true, name: true },
    });
    const courierNameMap = new Map(couriers.map((c) => [c.id, c.name]));

    for (const s of staleShifts) {
      this.gateway.broadcastToEstablishment(s.establishment_id, 'shift:ended', {
        shift_id: s.id,
        courier_id: s.courier_id,
        ended_by: 'auto',
        ended_at: endedAt,
      });
      const courierName = courierNameMap.get(s.courier_id) ?? s.courier_id;
      this.telegram
        .notifyEstablishmentManagers(
          s.establishment_id,
          `🕐 Зміну ${courierName} закрито автоматично (> 16 год без GPS-пінгу)`,
          MANAGER_EVENT.COURIER_SHIFT_AUTO_CLOSED,
        )
        .catch((err: unknown) =>
          this.logger.warn(
            'Telegram notification failed (shift_auto_closed)',
            err,
          ),
        );
    }

    this.logger.log(`Auto-closed ${staleShifts.length} stale shift(s)`);
    return staleShifts.length;
  }

  // ── Internal: notify couriers whose shift is ending soon (called by RetentionModule cron) ──

  async checkShiftEndingSoon(): Promise<number> {
    try {
      // Only load shifts ending within the next 2 hours — avoids full table scan at scale
      const windowCutoff = new Date(Date.now() + 2 * 60 * 60 * 1000);
      const shifts = await this.prisma.shift.findMany({
        where: {
          ended_at: null,
          planned_end_at: { not: null, lte: windowCutoff },
          courier: { telegram_chat_id: { not: null } },
        },
        select: {
          id: true,
          planned_end_at: true,
          courier: {
            select: { telegram_chat_id: true, telegram_prefs: true },
          },
          establishment: {
            select: { timezone: true },
          },
        },
      });

      let sent = 0;

      for (const shift of shifts) {
        const prefs =
          (shift.courier.telegram_prefs as CourierTelegramPrefs) ?? {};

        if (!shift.courier.telegram_chat_id) continue;
        if (!shift.planned_end_at) continue; // defensive guard — Prisma filter should prevent this
        if (!prefs.shift_ending_soon) continue;

        const thresholdMs = (prefs.shift_ending_soon_min ?? 30) * 60 * 1000;
        const msUntilEnd = shift.planned_end_at.getTime() - Date.now();

        if (msUntilEnd <= 0) continue; // shift already past planned end
        if (msUntilEnd > thresholdMs) continue; // not yet within warning window

        // Format message before consuming Redis key — if formatting throws (e.g. bad timezone),
        // we don't want to burn the dedup key and silence the notification for the full TTL.
        const minutesLeft = Math.round(msUntilEnd / 60000);
        let endTime: string;
        try {
          endTime = shift.planned_end_at.toLocaleTimeString('uk-UA', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: shift.establishment.timezone,
          });
        } catch (err) {
          this.logger.warn(
            `Invalid timezone for shift ${shift.id}: ${shift.establishment.timezone}`,
            err,
          );
          continue;
        }
        const text = `⏰ Зміна завершується через ${minutesLeft} хв (о ${endTime})`;

        // Minimum TTL of 5 min prevents 1-second key expiry causing duplicate sends
        const ttlSeconds = Math.max(300, Math.ceil(msUntilEnd / 1000));
        const isNew = await this.telegram.setNxWithTtl(
          `telegram:shift_ending_soon:${shift.id}`,
          ttlSeconds,
        );
        if (!isNew) continue; // already notified for this shift

        this.telegram
          .sendMessage(shift.courier.telegram_chat_id, text)
          .catch((err) =>
            this.logger.warn('Shift ending soon notify failed', err),
          );

        sent++;
      }

      return sent;
    } catch (err) {
      this.logger.error('checkShiftEndingSoon failed', err);
      return 0;
    }
  }

  // ── Internal: notify managers when courier stops responding during delivery ─

  async checkCourierNotResponding(): Promise<number> {
    try {
      const deliveries = await this.prisma.delivery.findMany({
        where: { status: DeliveryStatus.in_progress },
        select: {
          id: true,
          courier_id: true,
          courier: { select: { name: true, telegram_chat_id: true } },
          order: {
            select: { establishment_id: true, external_id: true, id: true },
          },
        },
      });

      if (deliveries.length === 0) return 0;

      const estIds = [
        ...new Set(deliveries.map((d) => d.order.establishment_id)),
      ];
      const establishments = await this.prisma.establishment.findMany({
        where: { id: { in: estIds } },
        select: { id: true, settings: true },
      });
      const estMap = new Map(establishments.map((e) => [e.id, e.settings]));

      // Batch GPS ping query — one GROUP BY instead of N per-delivery queries
      const courierIds = [...new Set(deliveries.map((d) => d.courier_id))];
      const pingRows = await this.prisma.$queryRaw<
        { courier_id: string; last_ping: Date | null }[]
      >`
        SELECT courier_id, MAX(created_at) AS last_ping
        FROM location_pings
        WHERE courier_id = ANY(ARRAY[${Prisma.join(courierIds)}]::uuid[])
        GROUP BY courier_id
      `;
      const pingMap = new Map(pingRows.map((r) => [r.courier_id, r.last_ping]));

      let sent = 0;

      for (const d of deliveries) {
        if (!d.courier.telegram_chat_id) continue;

        const settings = parseEstablishmentSettings(
          estMap.get(d.order.establishment_id),
        );
        const thresholdMin = settings.courier_not_responding_min;
        const thresholdMs = thresholdMin * 60 * 1000;

        const lastPing = pingMap.get(d.courier_id) ?? null;

        const isNotResponding =
          lastPing === null || Date.now() - lastPing.getTime() > thresholdMs;
        if (!isNotResponding) continue;

        const isNew = await this.telegram.setNxWithTtl(
          `telegram:courier_not_responding:${d.id}`,
          thresholdMin * 2 * 60,
        );
        if (!isNew) continue; // already notified within this window

        const minutesAgo = lastPing
          ? Math.round((Date.now() - lastPing.getTime()) / 60000)
          : thresholdMin;
        const orderId = d.order.external_id ?? d.order.id.slice(0, 8);
        const text = `⚠️ ${d.courier.name} не відповідає вже ${minutesAgo} хв (доставка #${orderId})`;

        this.telegram
          .notifyEstablishmentManagers(
            d.order.establishment_id,
            text,
            MANAGER_EVENT.COURIER_NOT_RESPONDING,
          )
          .catch((err) =>
            this.logger.warn('Courier not responding notify failed', err),
          );

        sent++;
      }

      return sent;
    } catch (err) {
      this.logger.error('checkCourierNotResponding failed', err);
      return 0;
    }
  }
}
