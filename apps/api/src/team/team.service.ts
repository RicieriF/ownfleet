import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthenticatedUser } from '../auth/auth.types.js';
import { CreateTeamMemberDto } from './dto/create-team-member.dto.js';
import { UpdateTeamMemberDto } from './dto/update-team-member.dto.js';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class TeamService {
  private readonly logger = new Logger(TeamService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(user: AuthenticatedUser) {
    return this.prisma.user.findMany({
      where: {
        establishment_id: user.establishment_id,
        role: { in: ['manager', 'dispatcher'] },
        courier_id: null,
      },
      select: {
        id: true,
        email: true,
        created_at: true,
        telegram_chat_id: true,
      },
      orderBy: { created_at: 'asc' },
    });
  }

  async create(dto: CreateTeamMemberDto, user: AuthenticatedUser) {
    this.assertOwner(user);

    const exists = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (exists) {
      throw new ConflictException('Користувач з таким email вже існує');
    }

    const password_hash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const member = await this.prisma.user.create({
      data: {
        establishment_id: user.establishment_id,
        email: dto.email,
        password_hash,
        role: 'manager',
      },
      select: {
        id: true,
        email: true,
        created_at: true,
        telegram_chat_id: true,
      },
    });

    this.logger.log(`Team member created: ${member.id} by ${user.id}`);
    return member;
  }

  async update(id: string, dto: UpdateTeamMemberDto, user: AuthenticatedUser) {
    this.assertOwner(user);
    const member = await this.assertBelongs(id, user);

    if (!dto.password) return member;

    return this.prisma.user.update({
      where: { id },
      data: { password_hash: await bcrypt.hash(dto.password, BCRYPT_ROUNDS) },
      select: {
        id: true,
        email: true,
        created_at: true,
        telegram_chat_id: true,
      },
    });
  }

  async remove(id: string, user: AuthenticatedUser) {
    this.assertOwner(user);
    await this.assertBelongs(id, user);

    if (id === user.id) {
      throw new ForbiddenException('Не можна видалити власний акаунт');
    }

    await this.prisma.user.delete({ where: { id } });
    this.logger.log(`Team member deleted: ${id} by ${user.id}`);
  }

  private assertOwner(user: AuthenticatedUser) {
    if (user.role !== 'owner' && !user.is_platform_admin) {
      throw new ForbiddenException('Тільки власник може управляти командою');
    }
  }

  private async assertBelongs(id: string, user: AuthenticatedUser) {
    const member = await this.prisma.user.findFirst({
      where: {
        id,
        establishment_id: user.establishment_id,
        role: { in: ['manager', 'dispatcher'] },
        courier_id: null,
      },
      select: {
        id: true,
        email: true,
        created_at: true,
        telegram_chat_id: true,
      },
    });
    if (!member) throw new NotFoundException('Учасника команди не знайдено');
    return member;
  }
}
