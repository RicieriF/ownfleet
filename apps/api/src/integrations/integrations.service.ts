import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { IntegrationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthenticatedUser } from '../auth/auth.types.js';
import { UpsertIntegrationDto } from './dto/upsert-integration.dto.js';
import { UpdateIntegrationDto } from './dto/update-integration.dto.js';

@Injectable()
export class IntegrationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(user: AuthenticatedUser) {
    return this.prisma.integration.findMany({
      where: { establishment_id: user.establishment_id },
      orderBy: { created_at: 'asc' },
      select: { id: true, type: true, active: true, config: true, created_at: true, updated_at: true },
    });
  }

  /** Upsert: one integration per type per establishment */
  async upsert(user: AuthenticatedUser, dto: UpsertIntegrationDto) {
    this.assertManagerOrOwner(user);

    return this.prisma.integration.upsert({
      where: {
        establishment_id_type: {
          establishment_id: user.establishment_id,
          type: dto.type as IntegrationType,
        },
      },
      create: {
        establishment_id: user.establishment_id,
        type: dto.type as IntegrationType,
        config: dto.config as Prisma.InputJsonValue,
        active: dto.active ?? true,
      },
      update: {
        config: dto.config as Prisma.InputJsonValue,
        active: dto.active ?? true,
      },
      select: { id: true, type: true, active: true, config: true, created_at: true, updated_at: true },
    });
  }

  async update(id: string, user: AuthenticatedUser, dto: UpdateIntegrationDto) {
    this.assertManagerOrOwner(user);
    await this.assertOwnership(id, user);

    return this.prisma.integration.update({
      where: { id },
      data: {
        ...(dto.config !== undefined && { config: dto.config as Prisma.InputJsonValue }),
        ...(dto.active !== undefined && { active: dto.active }),
      },
      select: { id: true, type: true, active: true, config: true, created_at: true, updated_at: true },
    });
  }

  async remove(id: string, user: AuthenticatedUser) {
    this.assertManagerOrOwner(user);
    await this.assertOwnership(id, user);
    await this.prisma.integration.delete({ where: { id } });
    return { deleted: true };
  }

  private async assertOwnership(id: string, user: AuthenticatedUser) {
    const integration = await this.prisma.integration.findUnique({
      where: { id },
      select: { establishment_id: true },
    });
    if (!integration) throw new NotFoundException('Integration not found');
    if (integration.establishment_id !== user.establishment_id) {
      throw new ForbiddenException('Access denied');
    }
  }

  private assertManagerOrOwner(user: AuthenticatedUser) {
    if (user.role !== 'owner' && user.role !== 'manager') {
      throw new ForbiddenException('Insufficient permissions');
    }
  }
}
