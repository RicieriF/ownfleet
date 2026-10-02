import { ForbiddenException, Injectable } from '@nestjs/common';
import { TripStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class DriverTripService {
  constructor(private readonly prisma: PrismaService) {}

  async listAssigned(user: AuthenticatedUser) {
    if (!user.courier_id) {
      throw new ForbiddenException('Only drivers can access assigned trips');
    }
    return this.prisma.trip.findMany({
      where: {
        establishment_id: user.establishment_id,
        courier_id: user.courier_id,
        status: { in: [TripStatus.planned, TripStatus.active] },
      },
      orderBy: [{ status: 'desc' }, { scheduled_at: 'asc' }],
      select: {
        id: true,
        status: true,
        school_safety: true,
        scheduled_at: true,
        started_at: true,
        eta_seconds: true,
        distance_meters: true,
        vehicle: {
          select: {
            id: true,
            name: true,
            plate: true,
            model: true,
            color: true,
          },
        },
        route: { select: { id: true, name: true } },
        passengers: {
          orderBy: { scheduled_pickup_at: 'asc' },
          select: {
            id: true,
            status: true,
            scheduled_pickup_at: true,
            ready_at: true,
            boarded_at: true,
            dropped_off_at: true,
            passenger: {
              select: {
                id: true,
                name: true,
                pickup_qr_required: true,
                handoff_qr_required: true,
              },
            },
            pickup_stop: {
              select: {
                id: true,
                name: true,
                address: true,
                lat: true,
                lng: true,
              },
            },
            dropoff_stop: {
              select: {
                id: true,
                name: true,
                address: true,
                lat: true,
                lng: true,
              },
            },
          },
        },
      },
    });
  }
}
