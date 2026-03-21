import { Module } from '@nestjs/common';
import { CouriersController } from './couriers.controller.js';
import { CouriersService } from './couriers.service.js';
import { EstablishmentsModule } from '../establishments/establishments.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [EstablishmentsModule, NotificationsModule],
  controllers: [CouriersController],
  providers: [CouriersService],
  exports: [CouriersService],
})
export class CouriersModule {}
