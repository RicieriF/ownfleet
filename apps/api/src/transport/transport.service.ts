import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CheckEventType,
  CheckValidationStatus,
  PassengerTripStatus,
  Prisma,
  TripStatus,
} from '@prisma/client';
import { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  assertPassengerTransition,
  assertTripCanComplete,
  eventGrantsConfirmedPassengerState,
} from './domain/trip-state.js';

export interface RecordCheckEventInput {
  event_uid: string;
  trip_id: string;
  trip_passenger_id: string;
  type: CheckEventType;
  validation_status: CheckValidationStatus;
  captured_at: Date;
  lat?: number;
  lng?: number;
  accuracy?: number;
  guardian_id?: string;
  qr_nonce_hash?: string;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class TransportService {
  constructor(private readonly prisma: PrismaService) {}

  async recordCheckEvent(input: RecordCheckEventInput, user: AuthenticatedUser) {
    if (!user.courier_id) {
      throw new ForbiddenException('Only drivers can record passenger check events');
    }

    const existing = await this.prisma.checkEvent.findUnique({
      where: { event_uid: input.event_uid },
    });
    if (existing) {
      if (existing.establishment_id !== user.establishment_id) {
        throw new ForbiddenException('Event belongs to another organization');
      }
      return existing;
    }

    const tripPassenger = await this.prisma.tripPassenger.findFirst({
      where: {
        id: input.trip_passenger_id,
        trip_id: input.trip_id,
        establishment_id: user.establishment_id,
      },
      include: { trip: true },
    });
    if (!tripPassenger) throw new NotFoundException('Trip passenger not found');
    if (tripPassenger.trip.courier_id !== user.courier_id) {
      throw new ForbiddenException('Trip is assigned to another driver');
    }
    if (tripPassenger.trip.status !== TripStatus.active) {
      throw new ConflictException('Passenger events require an active trip');
    }

    const nextState = this.stateForEvent(input.type);
    const grantsConfirmedState = eventGrantsConfirmedPassengerState(
      input.validation_status,
    );

    if (grantsConfirmedState && nextState) {
      assertPassengerTransition(tripPassenger.status, nextState);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const event = await tx.checkEvent.create({
          data: {
            establishment_id: user.establishment_id,
            event_uid: input.event_uid,
            trip_id: input.trip_id,
            trip_passenger_id: tripPassenger.id,
            passenger_id: tripPassenger.passenger_id,
            courier_id: user.courier_id!,
            guardian_id: input.guardian_id,
            type: input.type,
            validation_status: input.validation_status,
            captured_at: input.captured_at,
            lat: input.lat,
            lng: input.lng,
            accuracy: input.accuracy,
            qr_nonce_hash: input.qr_nonce_hash,
            metadata: input.metadata ?? {},
          },
        });

        if (grantsConfirmedState && nextState) {
          const update = await tx.tripPassenger.updateMany({
            where: {
              id: tripPassenger.id,
              establishment_id: user.establishment_id,
              status: tripPassenger.status,
            },
            data: {
              status: nextState,
              ...(nextState === PassengerTripStatus.boarded
                ? { boarded_at: input.captured_at }
                : {}),
              ...(nextState === PassengerTripStatus.dropped_off
                ? { dropped_off_at: input.captured_at }
                : {}),
            },
          });
          if (update.count === 0) {
            throw new ConflictException('Passenger state changed concurrently');
          }
        }

        return event;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const duplicate = await this.prisma.checkEvent.findUnique({
          where: { event_uid: input.event_uid },
        });
        if (duplicate?.establishment_id === user.establishment_id) return duplicate;
      }
      throw error;
    }
  }

  async completeTrip(tripId: string, user: AuthenticatedUser) {
    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, establishment_id: user.establishment_id },
      include: { passengers: { select: { status: true } } },
    });
    if (!trip) throw new NotFoundException('Trip not found');
    if (user.courier_id && trip.courier_id !== user.courier_id) {
      throw new ForbiddenException('Trip is assigned to another driver');
    }
    if (trip.status !== TripStatus.active) {
      throw new ConflictException('Only an active trip can be completed');
    }

    assertTripCanComplete(
      trip.school_safety,
      trip.passengers.map((passenger) => passenger.status),
    );

    const completedAt = new Date();
    const updated = await this.prisma.trip.updateMany({
      where: {
        id: trip.id,
        establishment_id: user.establishment_id,
        status: TripStatus.active,
      },
      data: { status: TripStatus.completed, completed_at: completedAt },
    });
    if (updated.count === 0) {
      throw new ConflictException('Trip was already transitioned');
    }
    return { id: trip.id, status: TripStatus.completed, completed_at: completedAt };
  }

  private stateForEvent(type: CheckEventType): PassengerTripStatus | null {
    switch (type) {
      case CheckEventType.board:
        return PassengerTripStatus.boarded;
      case CheckEventType.dropoff:
      case CheckEventType.guardian_handoff:
        return PassengerTripStatus.dropped_off;
      case CheckEventType.absence:
        return PassengerTripStatus.absent;
      case CheckEventType.incident:
        return PassengerTripStatus.incident;
      default:
        return null;
    }
  }
}
