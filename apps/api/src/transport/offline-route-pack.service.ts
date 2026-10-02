import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';

const CORRIDOR_MARGIN_METERS = 2_000;

@Injectable()
export class OfflineRoutePackService {
  constructor(private readonly prisma: PrismaService) {}

  async getManifest(tripId: string, user: AuthenticatedUser) {
    if (!user.courier_id) {
      throw new ForbiddenException('Only drivers can prepare offline routes');
    }
    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, establishment_id: user.establishment_id },
      select: {
        id: true,
        updated_at: true,
        courier_id: true,
        route: {
          select: {
            id: true,
            stops: {
              orderBy: { sequence: 'asc' },
              select: {
                id: true,
                name: true,
                sequence: true,
                lat: true,
                lng: true,
              },
            },
          },
        },
        passengers: {
          select: {
            passenger_id: true,
            pickup_stop: {
              select: { id: true, name: true, lat: true, lng: true },
            },
            dropoff_stop: {
              select: { id: true, name: true, lat: true, lng: true },
            },
          },
        },
      },
    });
    if (!trip) throw new NotFoundException('Trip not found');
    if (trip.courier_id !== user.courier_id) {
      throw new ForbiddenException('Trip is assigned to another driver');
    }

    const stopMap = new Map<
      string,
      {
        id: string;
        name: string;
        lat: number;
        lng: number;
        sequence: number | null;
      }
    >();
    for (const stop of trip.route?.stops ?? []) {
      if (stop.lat !== null && stop.lng !== null) {
        stopMap.set(stop.id, { ...stop, lat: stop.lat, lng: stop.lng });
      }
    }
    for (const passenger of trip.passengers) {
      for (const stop of [passenger.pickup_stop, passenger.dropoff_stop]) {
        if (stop && stop.lat !== null && stop.lng !== null) {
          if (!stopMap.has(stop.id)) {
            stopMap.set(stop.id, {
              ...stop,
              lat: stop.lat,
              lng: stop.lng,
              sequence: null,
            });
          }
        }
      }
    }
    const stops = [...stopMap.values()];
    const bounds = this.bounds(stops.map(({ lat, lng }) => ({ lat, lng })));
    return {
      manifest_version: 1,
      trip_id: trip.id,
      route_id: trip.route?.id ?? null,
      revision: trip.updated_at.toISOString(),
      margin_meters: CORRIDOR_MARGIN_METERS,
      bounds,
      stops,
      passenger_ids: trip.passengers.map((passenger) => passenger.passenger_id),
    };
  }

  private bounds(points: Array<{ lat: number; lng: number }>) {
    if (points.length === 0) return null;
    const latitudes = points.map((point) => point.lat);
    const longitudes = points.map((point) => point.lng);
    const centerLat = (Math.min(...latitudes) + Math.max(...latitudes)) / 2;
    const latMargin = CORRIDOR_MARGIN_METERS / 111_320;
    const lngMargin =
      CORRIDOR_MARGIN_METERS /
      (111_320 * Math.max(Math.cos((centerLat * Math.PI) / 180), 0.1));
    return {
      south: Math.min(...latitudes) - latMargin,
      west: Math.min(...longitudes) - lngMargin,
      north: Math.max(...latitudes) + latMargin,
      east: Math.max(...longitudes) + lngMargin,
    };
  }
}
