import { Module } from '@nestjs/common';
import { TeamController } from './team.controller.js';
import { TeamService } from './team.service.js';
import { EstablishmentsModule } from '../establishments/establishments.module.js';

@Module({
  imports: [EstablishmentsModule],
  controllers: [TeamController],
  providers: [TeamService],
})
export class TeamModule {}
