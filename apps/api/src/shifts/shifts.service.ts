import {
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StartShiftDto } from './dto/start-shift.dto';
import { UpdatePlannedEndDto } from './dto/update-planned-end.dto';
import { JwtPayload } from '../auth/auth.types';

@Injectable()
export class ShiftsService {
  private readonly logger = new Logger(ShiftsService.name);

  constructor(private readonly prisma: PrismaService) {}

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
    });

    this.logger.log(`Shift started: courier=${user.courier_id} shift=${shift.id}`);
    return shift;
  }

  // ── Courier: end own shift ────────────────────────────────────────────────

  async endShift(user: JwtPayload) {
    if (!user.courier_id) {
      throw new UnprocessableEntityException('User is not linked to a courier profile');
    }

    const shift = await this.prisma.shift.findFirst({
      where: { courier_id: user.courier_id, ended_at: null },
    });
    if (!shift) {
      throw new NotFoundException('No active shift found');
    }

    const updated = await this.prisma.shift.update({
      where: { id: shift.id },
      data: { ended_at: new Date(), ended_by: 'courier' },
    });

    this.logger.log(`Shift ended by courier: shift=${shift.id}`);
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
    });
    if (!shift) throw new NotFoundException('Shift not found');
    if (shift.ended_at) throw new ConflictException('Shift is already ended');

    const updated = await this.prisma.shift.update({
      where: { id: shiftId },
      data: { ended_at: new Date(), ended_by: 'manager' },
    });

    this.logger.log(`Shift ended by manager: shift=${shiftId}`);
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

    const staleShifts = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT s.id
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

    await this.prisma.shift.updateMany({
      where: { id: { in: staleShifts.map((s) => s.id) } },
      data: { ended_at: new Date(), ended_by: 'auto' },
    });

    this.logger.log(`Auto-closed ${staleShifts.length} stale shift(s)`);
    return staleShifts.length;
  }
}
