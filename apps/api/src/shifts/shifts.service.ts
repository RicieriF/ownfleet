import {
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TrackingGateway } from '../tracking/tracking.gateway';
import { TelegramService } from '../telegram/telegram.service.js';
import { CourierTelegramPrefs } from '../telegram/telegram.types.js';
import { StartShiftDto } from './dto/start-shift.dto';
import { UpdatePlannedEndDto } from './dto/update-planned-end.dto';
import { JwtPayload } from '../auth/auth.types';

@Injectable()
export class ShiftsService {
  private readonly logger = new Logger(ShiftsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: TrackingGateway,
    private readonly telegram: TelegramService,
  ) {}

  // ── Courier: start shift ──────────────────────────────────────────────────

  async startShift(user: JwtPayload, dto: StartShiftDto) {
    if (!user.courier_id) {
      throw new UnprocessableEntityException('User is not linked to a courier profile');
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
        planned_end_at: dto.planned_end_at ? new Date(dto.planned_end_at) : null,
      },
      include: { courier: { select: { name: true } } },
    });

    this.logger.log(`Shift started: courier=${user.courier_id} shift=${shift.id}`);
    this.gateway.broadcastToEstablishment(user.establishment_id, 'shift:started', {
      shift_id: shift.id,
      courier_id: shift.courier_id,
      started_at: shift.started_at,
      planned_end_at: shift.planned_end_at,
    });
    this.telegram.notifyEstablishmentManagers(
      user.establishment_id,
      `🟢 ${shift.courier.name} вийшов на зміну`,
      'courier_shift_started',
    ).catch(() => {});
    return shift;
  }

  // ── Courier: end own shift ────────────────────────────────────────────────

  async endShift(user: JwtPayload) {
    if (!user.courier_id) {
      throw new UnprocessableEntityException('User is not linked to a courier profile');
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
    this.gateway.broadcastToEstablishment(updated.establishment_id, 'shift:ended', {
      shift_id: updated.id,
      courier_id: updated.courier_id,
      ended_by: 'courier',
      ended_at: updated.ended_at,
    });
    this.telegram.notifyEstablishmentManagers(
      updated.establishment_id,
      `⚫ ${shift.courier.name} завершив зміну`,
      'courier_shift_ended',
    ).catch(() => {});
    return updated;
  }

  // ── Courier: get own active shift ─────────────────────────────────────────

  async getMyActiveShift(user: JwtPayload) {
    if (!user.courier_id) return null;

    const shift = await this.prisma.shift.findFirst({
      where: { courier_id: user.courier_id, ended_at: null },
    });
    return shift ?? null;
  }

  // ── Manager: end any courier shift ───────────────────────────────────────

  async endShiftByManager(shiftId: string, user: JwtPayload) {
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
    this.gateway.broadcastToEstablishment(updated.establishment_id, 'shift:ended', {
      shift_id: updated.id,
      courier_id: updated.courier_id,
      ended_by: 'manager',
      ended_at: updated.ended_at,
    });
    this.telegram.notifyEstablishmentManagers(
      updated.establishment_id,
      `⚫ ${shift.courier.name} — зміну завершено менеджером`,
      'courier_shift_ended',
    ).catch(() => {});
    return updated;
  }

  // ── Manager: update planned_end_at ────────────────────────────────────────

  async updatePlannedEnd(shiftId: string, user: JwtPayload, dto: UpdatePlannedEndDto) {
    const shift = await this.prisma.shift.findFirst({
      where: { id: shiftId, establishment_id: user.establishment_id, ended_at: null },
    });
    if (!shift) throw new NotFoundException('Active shift not found');

    return this.prisma.shift.update({
      where: { id: shiftId },
      data: {
        planned_end_at: dto.planned_end_at ? new Date(dto.planned_end_at) : null,
      },
    });
  }

  // ── Manager: get all active shifts for establishment ─────────────────────

  async getActiveShiftsForEstablishment(establishmentId: string) {
    return this.prisma.shift.findMany({
      where: { establishment_id: establishmentId, ended_at: null },
      include: {
        courier: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { started_at: 'asc' },
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
      this.telegram.notifyEstablishmentManagers(
        s.establishment_id,
        `🕐 Зміну ${courierName} закрито автоматично (> 16 год без GPS-пінгу)`,
        'courier_shift_auto_closed',
      ).catch(() => {});
    }

    this.logger.log(`Auto-closed ${staleShifts.length} stale shift(s)`);
    return staleShifts.length;
  }

  // ── Internal: notify couriers whose shift is ending soon (called by RetentionModule cron) ──

  async checkShiftEndingSoon(): Promise<number> {
    try {
      const shifts = await this.prisma.shift.findMany({
        where: {
          ended_at: null,
          planned_end_at: { not: null },
          courier: { telegram_chat_id: { not: null } },
        },
        select: {
          id: true,
          planned_end_at: true,
          courier: {
            select: { telegram_chat_id: true, telegram_prefs: true },
          },
        },
      });

      let sent = 0;

      for (const shift of shifts) {
        const prefs = (shift.courier.telegram_prefs as CourierTelegramPrefs) ?? {};

        if (!shift.courier.telegram_chat_id) continue;
        if (!shift.planned_end_at) continue; // defensive guard — Prisma filter should prevent this
        if (!prefs.shift_ending_soon) continue;

        const thresholdMs = (prefs.shift_ending_soon_min ?? 30) * 60 * 1000;
        const msUntilEnd = shift.planned_end_at.getTime() - Date.now();

        if (msUntilEnd <= 0) continue;          // shift already past planned end
        if (msUntilEnd > thresholdMs) continue; // not yet within warning window

        // Minimum TTL of 5 min prevents 1-second key expiry causing duplicate sends
        const ttlSeconds = Math.max(300, Math.ceil(msUntilEnd / 1000));
        const isNew = await this.telegram.setNxWithTtl(
          `telegram:shift_ending_soon:${shift.id}`,
          ttlSeconds,
        );
        if (!isNew) continue; // already notified for this shift

        const minutesLeft = Math.round(msUntilEnd / 60000);
        // TODO: use establishment timezone once establishments.timezone field is added
        const endTime = shift.planned_end_at.toLocaleTimeString('uk-UA', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'UTC',
        });
        const text = `⏰ Зміна завершується через ${minutesLeft} хв (о ${endTime})`;

        this.telegram
          .sendMessage(shift.courier.telegram_chat_id!, text)
          .catch((err) => this.logger.warn('Shift ending soon notify failed', err));

        sent++;
      }

      return sent;
    } catch (err) {
      this.logger.error('checkShiftEndingSoon failed', err);
      return 0;
    }
  }
}
