import { Module } from '@nestjs/common';
import { TransportController } from './transport.controller.js';
import { TransportService } from './transport.service.js';
import { FamilyTransportController } from './family-transport.controller.js';
import { FamilyTransportService } from './family-transport.service.js';
import { TripAssignmentService } from './trip-assignment.service.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { TransportApproachService } from './transport-approach.service.js';
import { OfflineRoutePackService } from './offline-route-pack.service.js';
import { DriverTripService } from './driver-trip.service.js';

@Module({
  imports: [NotificationsModule],
  controllers: [TransportController, FamilyTransportController],
  providers: [
    TransportService,
    FamilyTransportService,
    TripAssignmentService,
    TransportApproachService,
    OfflineRoutePackService,
    DriverTripService,
  ],
  exports: [
    TransportService,
    FamilyTransportService,
    TripAssignmentService,
    TransportApproachService,
    OfflineRoutePackService,
    DriverTripService,
  ],
})
export class TransportModule {}
