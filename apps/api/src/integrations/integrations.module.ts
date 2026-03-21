import { Module } from '@nestjs/common';
import { PosterController } from './poster.controller.js';
import { PosterService } from './poster.service.js';
import { IikoService } from './iiko.service.js';

@Module({
  controllers: [PosterController],
  providers: [PosterService, IikoService],
})
export class IntegrationsModule {}
