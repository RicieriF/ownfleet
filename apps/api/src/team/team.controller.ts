import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PlanAccessGuard } from '../establishments/guards/plan-access.guard.js';
import { TeamService } from './team.service.js';
import { CreateTeamMemberDto } from './dto/create-team-member.dto.js';
import { UpdateTeamMemberDto } from './dto/update-team-member.dto.js';
import { AuthenticatedUser } from '../auth/auth.types.js';

@Controller('team')
@UseGuards(JwtAuthGuard, PlanAccessGuard)
export class TeamController {
  constructor(private readonly service: TeamService) {}

  @Get()
  findAll(@Req() req: any) {
    return this.service.findAll(req.user as AuthenticatedUser);
  }

  @Post()
  create(@Body() dto: CreateTeamMemberDto, @Req() req: any) {
    return this.service.create(dto, req.user as AuthenticatedUser);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTeamMemberDto,
    @Req() req: any,
  ) {
    return this.service.update(id, dto, req.user as AuthenticatedUser);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @Req() req: any) {
    return this.service.remove(id, req.user as AuthenticatedUser);
  }
}
