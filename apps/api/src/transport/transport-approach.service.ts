import { Inject, Injectable, Logger } from '@nestjs/common';
import { PassengerTripStatus, TripStatus } from '@prisma/client';
import type IORedis from 'ioredis';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { haversineMeters } from '../shared/geo.js';
import { REDIS_CLIENT } from '../shared/redis/redis.constants.js';

const APPROACH_RADIUS_METERS = 1_000;
const APPROACH_DEDUP_TTL_SECONDS = 12 * 60 * 60;

@Injectable()
export class TransportApproachService {
  private readonly logger = new Logger(TransportApproachService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
    private readonly notifications: NotificationsService,
  ) {}

  async handlePosition(
    courierId: string,
    establishmentId: string,
    lat: number,
    lng: number,
  ): Promise<void> {
    const assignments = await this.prisma.tripPassenger.findMany({
      where: {
        establishment_id: establishmentId,
        status: PassengerTripStatus.waiting,
        trip: { courier_id: courierId, status: TripStatus.active },
        pickup_stop: { lat: { not: null }, lng: { not: null } },
      },
      select: {
        id: true,
        trip_id: true,
        passenger: {
          select: {
            name: true,
            guardians: {
              where: { guardian: { active: true } },
              select: { guardian_id: true },
            },
          },
        },
        pickup_stop: {
          select: { lat: true, lng: true, geofence_meters: true },
        },
      },
    });

    for (const assignment of assignments) {
      const stop = assignment.pickup_stop;
      if (!stop || stop.lat === null || stop.lng === null) continue;
      const distanceMeters = haversineMeters(lat, lng, stop.lat, stop.lng);
      const radiusMeters = Math.max(
        stop.geofence_meters,
        APPROACH_RADIUS_METERS,
      );
      if (distanceMeters > radiusMeters) continue;

      const dedupKey = `transport:approach:${assignment.trip_id}:${assignment.id}`;
      const acquired = await this.redis.set(
        dedupKey,
        '1',
        'EX',
        APPROACH_DEDUP_TTL_SECONDS,
        'NX',
      );
      if (!acquired) continue;

      const data = {
        trip_id: assignment.trip_id,
        trip_passenger_id: assignment.id,
        event_type: 'vehicle_approaching',
      };
      const results = await Promise.allSettled(
        assignment.passenger.guardians.map((link) =>
          this.notifications.sendGuardianPush(link.guardian_id, {
            title: 'Van chegando',
            body: `A van está se aproximando para buscar ${assignment.passenger.name}.`,
            data,
          }),
        ),
      );
      if (results.some((result) => result.status === 'rejected')) {
        this.logger.warn(
          `One or more approach notifications failed for ${assignment.id}`,
        );
      }
    }
  }
}
