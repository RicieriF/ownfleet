import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Plan } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateEstablishmentDto } from './dto/create-establishment.dto.js';
import { UpdateSettingsDto } from './dto/update-settings.dto.js';
import { AuthenticatedUser } from '../auth/auth.types.js';

@Injectable()
export class EstablishmentsService {
  private readonly logger = new Logger(EstablishmentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateEstablishmentDto, userId: string) {
    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    const establishment = await this.prisma.establishment.create({
      data: {
        name: dto.name,
        plan: Plan.starter,
        trial_ends_at: trialEndsAt,
      },
    });

    // Assign creator as owner
    await this.prisma.user.update({
      where: { id: userId },
      data: { establishment_id: establishment.id },
    });

    return establishment;
  }

  async findOne(user: AuthenticatedUser) {
    const est = await this.prisma.establishment.findUnique({
      where: { id: user.establishment_id },
    });

    if (!est) throw new NotFoundException('Establishment not found');
    return est;
  }

  async getSettings(user: AuthenticatedUser) {
    const est = await this.prisma.establishment.findUniqueOrThrow({
      where: { id: user.establishment_id },
      select: { settings: true },
    });
    return est.settings;
  }

  async updateSettings(user: AuthenticatedUser, dto: UpdateSettingsDto) {
    this.assertManagerOrOwner(user);

    const est = await this.prisma.establishment.findUniqueOrThrow({
      where: { id: user.establishment_id },
      select: { settings: true },
    });

    const currentSettings = (est.settings ?? {}) as Record<string, unknown>;
    const merged = { ...currentSettings, ...dto };

    return this.prisma.establishment.update({
      where: { id: user.establishment_id },
      data: { settings: merged },
      select: { settings: true },
    });
  }

  private assertManagerOrOwner(user: AuthenticatedUser): void {
    if (user.role !== 'owner' && user.role !== 'manager') {
      throw new ForbiddenException('Insufficient permissions');
    }
  }
}
