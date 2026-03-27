import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateSettingsDto } from './dto/update-settings.dto.js';
import { AuthenticatedUser } from '../auth/auth.types.js';

@Injectable()
export class EstablishmentsService {
  private readonly logger = new Logger(EstablishmentsService.name);

  constructor(private readonly prisma: PrismaService) {}

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
      select: { settings: true, timezone: true, dispatch_mode: true, delivery_sla_minutes: true, lat: true, lng: true },
    });
    return est;
  }

  async updateSettings(user: AuthenticatedUser, dto: UpdateSettingsDto) {
    this.assertManagerOrOwner(user);

    // Extract separate columns; the rest go into JSONB settings
    const { timezone, delivery_sla_minutes, lat, lng, dispatch_mode, ...settingsFields } = dto;

    const est = await this.prisma.establishment.findUniqueOrThrow({
      where: { id: user.establishment_id },
      select: { settings: true },
    });

    const currentSettings = (est.settings ?? {}) as Record<string, unknown>;
    const merged = { ...currentSettings, ...settingsFields };

    return this.prisma.establishment.update({
      where: { id: user.establishment_id },
      data: {
        settings: merged,
        ...(timezone !== undefined && { timezone }),
        ...(delivery_sla_minutes !== undefined && { delivery_sla_minutes }),
        ...(lat !== undefined && { lat }),
        ...(lng !== undefined && { lng }),
        ...(dispatch_mode !== undefined && { dispatch_mode }),
      },
      select: {
        settings: true,
        timezone: true,
        delivery_sla_minutes: true,
        lat: true,
        lng: true,
        dispatch_mode: true,
      },
    });
  }

  private assertManagerOrOwner(user: AuthenticatedUser): void {
    if (user.role !== 'owner' && user.role !== 'manager') {
      throw new ForbiddenException('Insufficient permissions');
    }
  }
}
