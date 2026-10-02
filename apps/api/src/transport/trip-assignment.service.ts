import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { TripStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface ReassignTripInput {
  courier_id?: string;
  vehicle_id?: string;
  reason: string;
}

@Injectable()
export class TripAssignmentService {
  private readonly logger = new Logger(TripAssignmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async reassign(
    tripId: string,
    input: ReassignTripInput,
    user: AuthenticatedUser,
  ) {
    if (user.courier_id) {
      throw new ForbiddenException('Drivers cannot reassign active trips');
    }
    if (!input.courier_id && !input.vehicle_id) {
      throw new BadRequestException('A new driver or vehicle is required');
    }

    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, establishment_id: user.establishment_id },
      select: {
        id: true,
        status: true,
        courier_id: true,
        vehicle_id: true,
      },
    });
    if (!trip) throw new NotFoundException('Trip not found');
    if (
      trip.status !== TripStatus.active &&
      trip.status !== TripStatus.planned
    ) {
      throw new ConflictException(
        'Only planned or active trips can be reassigned',
      );
    }

    const nextCourierId = input.courier_id ?? trip.courier_id;
    const nextVehicleId = input.vehicle_id ?? trip.vehicle_id;
    if (
      nextCourierId === trip.courier_id &&
      nextVehicleId === trip.vehicle_id
    ) {
      throw new ConflictException('Trip assignment is unchanged');
    }

    const [courier, vehicle] = await Promise.all([
      this.prisma.courier.findFirst({
        where: {
          id: nextCourierId,
          establishment_id: user.establishment_id,
          active: true,
        },
        select: { id: true, name: true },
      }),
      nextVehicleId
        ? this.prisma.vehicle.findFirst({
            where: {
              id: nextVehicleId,
              establishment_id: user.establishment_id,
              active: true,
            },
            select: { id: true, plate: true },
          })
        : Promise.resolve(null),
    ]);
    if (!courier) throw new NotFoundException('Driver not found');
    if (nextVehicleId && !vehicle)
      throw new NotFoundException('Vehicle not found');

    const changedAt = new Date();
    const change = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.trip.updateMany({
        where: {
          id: trip.id,
          establishment_id: user.establishment_id,
          courier_id: trip.courier_id,
          vehicle_id: trip.vehicle_id,
          status: trip.status,
        },
        data: { courier_id: nextCourierId, vehicle_id: nextVehicleId },
      });
      if (updated.count === 0) {
        throw new ConflictException('Trip assignment changed concurrently');
      }
      return tx.tripAssignmentChange.create({
        data: {
          establishment_id: user.establishment_id,
          trip_id: trip.id,
          changed_by_user_id: user.id,
          old_courier_id: trip.courier_id,
          new_courier_id: nextCourierId,
          old_vehicle_id: trip.vehicle_id,
          new_vehicle_id: nextVehicleId,
          reason: input.reason.trim(),
          created_at: changedAt,
        },
      });
    });

    const guardianLinks = await this.prisma.passengerGuardian.findMany({
      where: {
        passenger: {
          trip_passengers: { some: { trip_id: trip.id } },
        },
        guardian: { active: true },
      },
      distinct: ['guardian_id'],
      select: { guardian_id: true },
    });
    const vehicleLabel = vehicle?.plate ? `, vehicle ${vehicle.plate}` : '';
    for (const link of guardianLinks) {
      void this.notifications
        .sendGuardianPush(link.guardian_id, {
          title: 'Trip assignment changed',
          body: `Driver: ${courier.name}${vehicleLabel}`,
          data: { trip_id: trip.id, assignment_change_id: change.id },
        })
        .catch((error: unknown) =>
          this.logger.warn(
            `Guardian assignment notification failed for ${link.guardian_id}`,
            error,
          ),
        );
    }

    return {
      ...change,
      current_assignment: {
        courier_id: nextCourierId,
        vehicle_id: nextVehicleId,
      },
    };
  }
}
