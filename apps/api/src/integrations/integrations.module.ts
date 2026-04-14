import { Module } from '@nestjs/common';
import { PosterController } from './poster.controller.js';
import { PosterService } from './poster.service.js';
import { IikoService } from './iiko.service.js';
import { IntegrationsController } from './integrations.controller.js';
import { IntegrationsService } from './integrations.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { EstablishmentsModule } from '../establishments/establishments.module.js';
import { GeocodingModule } from '../geocoding/geocoding.module.js';
import { TelegramModule } from '../telegram/telegram.module.js';

@Module({
  imports: [PrismaModule, EstablishmentsModule, GeocodingModule, TelegramModule],
  controllers: [PosterController, IntegrationsController],
  providers: [PosterService, IikoService, IntegrationsService],
})
export class IntegrationsModule {}
