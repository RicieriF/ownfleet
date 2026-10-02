import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  CheckEvent,
  CheckEventType,
  CheckValidationStatus,
  PassengerTripStatus,
  PassengerQrAction,
  Prisma,
  TripStatus,
} from '@prisma/client';
import { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { haversineMeters } from '../shared/geo.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  assertPassengerTransition,
  assertTripCanComplete,
  eventGrantsConfirmedPassengerState,
} from './domain/trip-state.js';

const MAX_SCHOOL_GPS_ACCURACY_METERS = 100;
const MAX_SCHOOL_ACCURACY_TOLERANCE_METERS = 50;

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
  qr_token?: string;
  override_reason?: string;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class TransportService {
  private readonly logger = new Logger(TransportService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  async createAuthorizedPickup(
    passengerId: string,
    guardianId: string,
    validFrom: Date | undefined,
    validUntil: Date | undefined,
    user: AuthenticatedUser,
  ) {
    if (user.courier_id) {
      throw new ForbiddenException(
        'Drivers cannot manage pickup authorizations',
      );
    }
    if (validFrom && validUntil && validUntil <= validFrom) {
      throw new BadRequestException('Authorization end must follow its start');
    }
    const [passenger, guardian] = await Promise.all([
      this.prisma.passenger.findFirst({
        where: {
          id: passengerId,
          establishment_id: user.establishment_id,
          active: true,
        },
        select: { id: true },
      }),
      this.prisma.guardian.findFirst({
        where: {
          id: guardianId,
          establishment_id: user.establishment_id,
          active: true,
        },
        select: { id: true },
      }),
    ]);
    if (!passenger || !guardian) {
      throw new NotFoundException('Passenger or guardian not found');
    }
    return this.prisma.authorizedPickup.create({
      data: {
        establishment_id: user.establishment_id,
        passenger_id: passenger.id,
        guardian_id: guardian.id,
        valid_from: validFrom,
        valid_until: validUntil,
      },
    });
  }

  async revokeAuthorizedPickup(id: string, user: AuthenticatedUser) {
    if (user.courier_id) {
      throw new ForbiddenException(
        'Drivers cannot manage pickup authorizations',
      );
    }
    const authorization = await this.prisma.authorizedPickup.findFirst({
      where: { id, establishment_id: user.establishment_id },
    });
    if (!authorization) {
      throw new NotFoundException('Pickup authorization not found');
    }
    if (!authorization.active) return authorization;
    return this.prisma.authorizedPickup.update({
      where: { id: authorization.id },
      data: { active: false },
    });
  }

  async listAuthorizedPickups(passengerId: string, user: AuthenticatedUser) {
    if (user.courier_id) {
      throw new ForbiddenException(
        'Drivers cannot manage pickup authorizations',
      );
    }
    const passenger = await this.prisma.passenger.findFirst({
      where: {
        id: passengerId,
        establishment_id: user.establishment_id,
      },
      select: { id: true },
    });
    if (!passenger) throw new NotFoundException('Passenger not found');
    return this.prisma.authorizedPickup.findMany({
      where: {
        passenger_id: passenger.id,
        establishment_id: user.establishment_id,
      },
      include: { guardian: true },
      orderBy: { created_at: 'desc' },
    });
  }

  async issuePassengerQrToken(
    tripPassengerId: string,
    action: PassengerQrAction,
    ttlSeconds: number,
    user: AuthenticatedUser,
  ) {
    if (user.courier_id) {
      throw new ForbiddenException('Drivers cannot issue passenger QR tokens');
    }
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 600) {
      throw new BadRequestException(
        'QR token TTL must be between 30 and 600 seconds',
      );
    }
    const tripPassenger = await this.prisma.tripPassenger.findFirst({
      where: {
        id: tripPassengerId,
        establishment_id: user.establishment_id,
      },
      include: { trip: true },
    });
    if (!tripPassenger) throw new NotFoundException('Trip passenger not found');
    if (
      tripPassenger.trip.status !== TripStatus.planned &&
      tripPassenger.trip.status !== TripStatus.active
    ) {
      throw new ConflictException('QR tokens require a planned or active trip');
    }

    const secret = randomBytes(24).toString('base64url');
    const nonce = randomBytes(16).toString('base64url');
    const token = `${secret}.${nonce}`;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    await this.prisma.passengerQrToken.create({
      data: {
        establishment_id: user.establishment_id,
        passenger_id: tripPassenger.passenger_id,
        trip_id: tripPassenger.trip_id,
        courier_id: tripPassenger.trip.courier_id,
        vehicle_id: tripPassenger.trip.vehicle_id,
        action,
        token_hash: this.hashQrValue(secret),
        nonce_hash: this.hashQrValue(nonce),
        expires_at: expiresAt,
      },
    });

    return { token, action, expires_at: expiresAt };
  }

  async recordCheckEvent(
    input: RecordCheckEventInput,
    user: AuthenticatedUser,
  ) {
    if (!user.courier_id) {
      throw new ForbiddenException(
        'Only drivers can record passenger check events',
      );
    }

    const existing = await this.prisma.checkEvent.findUnique({
      where: { event_uid: input.event_uid },
    });
    if (existing) {
      if (existing.establishment_id !== user.establishment_id) {
        throw new ForbiddenException('Event belongs to another organization');
      }
      this.assertIdempotentReplay(existing, input, user.courier_id);
      return existing;
    }

    const tripPassenger = await this.prisma.tripPassenger.findFirst({
      where: {
        id: input.trip_passenger_id,
        trip_id: input.trip_id,
        establishment_id: user.establishment_id,
      },
      include: { trip: true, passenger: true, dropoff_stop: true },
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
    const qrAction = this.qrActionForEvent(input.type);
    const qrRequired =
      qrAction === PassengerQrAction.board
        ? tripPassenger.passenger.pickup_qr_required
        : qrAction === PassengerQrAction.guardian_handoff
          ? tripPassenger.passenger.handoff_qr_required
          : false;
    const now = new Date();
    let qrToken: Awaited<
      ReturnType<typeof this.prisma.passengerQrToken.findUnique>
    > = null;
    let qrException: { id: string; used_count: number } | null = null;
    let schoolGeofenceAudit: Prisma.InputJsonObject | undefined;

    if (input.override_reason?.trim() && (!qrRequired || !qrAction)) {
      throw new ConflictException(
        'QR override is not applicable to this event',
      );
    }

    if (
      grantsConfirmedState &&
      tripPassenger.trip.school_safety &&
      input.type === CheckEventType.dropoff
    ) {
      const stop = tripPassenger.dropoff_stop;
      if (!stop || stop.lat === null || stop.lng === null) {
        throw new ConflictException(
          'School drop-off stop has no geofence coordinates',
        );
      }
      if (
        input.lat === undefined ||
        input.lng === undefined ||
        input.accuracy === undefined
      ) {
        throw new BadRequestException(
          'School drop-off requires location and GPS accuracy',
        );
      }
      if (
        input.accuracy < 0 ||
        input.accuracy > MAX_SCHOOL_GPS_ACCURACY_METERS
      ) {
        throw new BadRequestException(
          `School drop-off requires GPS accuracy of ${MAX_SCHOOL_GPS_ACCURACY_METERS} meters or better`,
        );
      }
      const distanceMeters = haversineMeters(
        input.lat,
        input.lng,
        stop.lat,
        stop.lng,
      );
      const toleranceMeters = Math.min(
        input.accuracy,
        MAX_SCHOOL_ACCURACY_TOLERANCE_METERS,
      );
      const allowedMeters = stop.geofence_meters + toleranceMeters;
      if (distanceMeters > allowedMeters) {
        throw new ForbiddenException('School drop-off is outside the geofence');
      }
      schoolGeofenceAudit = {
        stop_id: stop.id,
        distance_meters: Math.round(distanceMeters),
        radius_meters: stop.geofence_meters,
        accuracy_tolerance_meters: toleranceMeters,
      };
    }

    if (grantsConfirmedState && qrRequired && qrAction) {
      if (input.override_reason?.trim()) {
        // The reason is persisted below in server-controlled audit metadata.
      } else {
        const exceptions = await this.prisma.passengerQrException.findMany({
          where: {
            establishment_id: user.establishment_id,
            passenger_id: tripPassenger.passenger_id,
            action: qrAction,
            revoked_at: null,
            valid_from: { lte: now },
            valid_until: { gte: now },
            OR: [{ trip_id: null }, { trip_id: input.trip_id }],
          },
          select: { id: true, used_count: true, max_uses: true },
          orderBy: { created_at: 'asc' },
        });
        const availableException = exceptions.find(
          (exception) => exception.used_count < exception.max_uses,
        );
        if (availableException) {
          qrException = availableException;
        } else {
          if (!input.qr_token) {
            throw new ForbiddenException('Passenger QR is required');
          }
          const parsedQr = this.parseQrToken(input.qr_token);
          qrToken = await this.prisma.passengerQrToken.findUnique({
            where: { token_hash: this.hashQrValue(parsedQr.secret) },
          });
          if (!qrToken || qrToken.establishment_id !== user.establishment_id) {
            throw new ForbiddenException('Invalid passenger QR');
          }
          if (qrToken.used_at) {
            throw new ConflictException('Passenger QR was already used');
          }
          if (qrToken.expires_at <= now) {
            throw new ForbiddenException('Passenger QR has expired');
          }
          if (!this.hashesMatch(qrToken.nonce_hash, parsedQr.nonce)) {
            throw new ForbiddenException('Invalid passenger QR');
          }
          if (
            qrToken.passenger_id !== tripPassenger.passenger_id ||
            qrToken.trip_id !== input.trip_id ||
            qrToken.action !== qrAction ||
            qrToken.courier_id !== user.courier_id ||
            qrToken.vehicle_id !== tripPassenger.trip.vehicle_id
          ) {
            throw new ForbiddenException('Passenger QR context does not match');
          }
        }
      }
    }

    if (input.type === CheckEventType.guardian_handoff) {
      if (!input.guardian_id) {
        throw new ConflictException('Guardian handoff requires a guardian');
      }
      const authorized = await this.prisma.authorizedPickup.findFirst({
        where: {
          establishment_id: user.establishment_id,
          passenger_id: tripPassenger.passenger_id,
          guardian_id: input.guardian_id,
          active: true,
          AND: [
            { OR: [{ valid_from: null }, { valid_from: { lte: now } }] },
            { OR: [{ valid_until: null }, { valid_until: { gte: now } }] },
          ],
        },
      });
      if (!authorized) {
        throw new ForbiddenException('Guardian is not authorized for pickup');
      }
    }

    if (grantsConfirmedState && nextState) {
      assertPassengerTransition(tripPassenger.status, nextState);
    }

    try {
      const event = await this.prisma.$transaction(async (tx) => {
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
            qr_nonce_hash: qrToken?.nonce_hash,
            metadata: this.auditMetadata(
              input,
              qrToken?.id,
              qrException?.id,
              schoolGeofenceAudit,
            ),
          },
        });

        if (qrToken) {
          const consumed = await tx.passengerQrToken.updateMany({
            where: { id: qrToken.id, used_at: null, expires_at: { gt: now } },
            data: { used_at: now },
          });
          if (consumed.count === 0) {
            throw new ConflictException('Passenger QR was already used');
          }
        }
        if (qrException) {
          const consumed = await tx.passengerQrException.updateMany({
            where: { id: qrException.id, used_count: qrException.used_count },
            data: { used_count: { increment: 1 } },
          });
          if (consumed.count === 0) {
            throw new ConflictException('QR exception was already consumed');
          }
        }

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
      if (grantsConfirmedState) {
        void this.notifyGuardians(
          user.establishment_id,
          tripPassenger.passenger_id,
          input,
        ).catch((error: unknown) =>
          this.logger.warn(
            `Guardian check-event notification failed for ${input.event_uid}`,
            error,
          ),
        );
      }
      return event;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const duplicate = await this.prisma.checkEvent.findUnique({
          where: { event_uid: input.event_uid },
        });
        if (duplicate?.establishment_id === user.establishment_id) {
          this.assertIdempotentReplay(duplicate, input, user.courier_id);
          return duplicate;
        }
      }
      throw error;
    }
  }

  private async notifyGuardians(
    establishmentId: string,
    passengerId: string,
    input: RecordCheckEventInput,
  ): Promise<void> {
    if (!this.notifications) return;
    const notification = this.notificationForEvent(input.type);
    if (!notification) return;
    const [links, establishment] = await Promise.all([
      this.prisma.passengerGuardian.findMany({
        where: {
          passenger_id: passengerId,
          guardian: { active: true },
        },
        distinct: ['guardian_id'],
        select: { guardian_id: true },
      }),
      this.prisma.establishment.findUnique({
        where: { id: establishmentId },
        select: { timezone: true },
      }),
    ]);
    const time = new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: establishment?.timezone ?? 'UTC',
    }).format(input.captured_at);
    await Promise.allSettled(
      links.map((link) =>
        this.notifications!.sendGuardianPush(link.guardian_id, {
          title: notification.title,
          body: notification.withTime
            ? `${notification.body} ${time}`
            : notification.body,
          data: {
            trip_id: input.trip_id,
            trip_passenger_id: input.trip_passenger_id,
            event_uid: input.event_uid,
            event_type: input.type,
          },
        }),
      ),
    );
  }

  private notificationForEvent(type: CheckEventType) {
    if (type === CheckEventType.board) {
      return { title: 'Transporte', body: 'Embarcou às', withTime: true };
    }
    if (type === CheckEventType.dropoff) {
      return { title: 'Transporte', body: 'Chegou na escola', withTime: false };
    }
    if (type === CheckEventType.guardian_handoff) {
      return {
        title: 'Transporte',
        body: 'Entrega confirmada às',
        withTime: true,
      };
    }
    return null;
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
    return {
      id: trip.id,
      status: TripStatus.completed,
      completed_at: completedAt,
    };
  }

  async startTrip(tripId: string, user: AuthenticatedUser) {
    if (!user.courier_id) {
      throw new ForbiddenException('Only drivers can start trips');
    }
    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, establishment_id: user.establishment_id },
    });
    if (!trip) throw new NotFoundException('Trip not found');
    if (trip.courier_id !== user.courier_id) {
      throw new ForbiddenException('Trip is assigned to another driver');
    }
    if (trip.status === TripStatus.active) return trip;
    if (trip.status !== TripStatus.planned) {
      throw new ConflictException('Only a planned trip can be started');
    }
    const startedAt = new Date();
    const updated = await this.prisma.trip.updateMany({
      where: {
        id: trip.id,
        establishment_id: user.establishment_id,
        courier_id: user.courier_id,
        status: TripStatus.planned,
      },
      data: { status: TripStatus.active, started_at: startedAt },
    });
    if (updated.count === 0) {
      throw new ConflictException('Trip state changed concurrently');
    }
    return { ...trip, status: TripStatus.active, started_at: startedAt };
  }

  private stateForEvent(type: CheckEventType): PassengerTripStatus | null {
    switch (type) {
      case CheckEventType.board:
        return PassengerTripStatus.boarded;
      case CheckEventType.depart:
        return PassengerTripStatus.in_transit;
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

  private assertIdempotentReplay(
    event: CheckEvent,
    input: RecordCheckEventInput,
    courierId: string,
  ): void {
    const matches =
      event.trip_id === input.trip_id &&
      event.trip_passenger_id === input.trip_passenger_id &&
      event.courier_id === courierId &&
      event.guardian_id === (input.guardian_id ?? null) &&
      event.type === input.type &&
      event.validation_status === input.validation_status &&
      event.captured_at.getTime() === input.captured_at.getTime() &&
      event.lat === (input.lat ?? null) &&
      event.lng === (input.lng ?? null) &&
      event.accuracy === (input.accuracy ?? null) &&
      (input.qr_token
        ? event.qr_nonce_hash ===
          this.hashQrValue(this.parseQrToken(input.qr_token).nonce)
        : true);

    if (!matches) {
      throw new ConflictException(
        'event_uid already belongs to a different passenger event',
      );
    }
  }

  private qrActionForEvent(type: CheckEventType): PassengerQrAction | null {
    if (type === CheckEventType.board) return PassengerQrAction.board;
    if (type === CheckEventType.guardian_handoff) {
      return PassengerQrAction.guardian_handoff;
    }
    return null;
  }

  private hashQrValue(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private parseQrToken(token: string): { secret: string; nonce: string } {
    const [secret, nonce, extra] = token.split('.');
    if (!secret || !nonce || extra) {
      throw new ForbiddenException('Invalid passenger QR');
    }
    return { secret, nonce };
  }

  private hashesMatch(expectedHash: string, rawValue: string): boolean {
    const actualHash = this.hashQrValue(rawValue);
    return timingSafeEqual(
      Buffer.from(expectedHash, 'hex'),
      Buffer.from(actualHash, 'hex'),
    );
  }

  private auditMetadata(
    input: RecordCheckEventInput,
    qrTokenId?: string,
    qrExceptionId?: string,
    schoolGeofence?: Prisma.InputJsonObject,
  ): Prisma.InputJsonObject {
    const metadata: Prisma.InputJsonObject = this.isJsonObject(input.metadata)
      ? input.metadata
      : {};
    return {
      ...metadata,
      transport_verification: input.override_reason?.trim()
        ? { mode: 'driver_override', reason: input.override_reason.trim() }
        : qrExceptionId
          ? { mode: 'guardian_exception', exception_id: qrExceptionId }
          : qrTokenId
            ? { mode: 'qr', token_id: qrTokenId }
            : { mode: 'not_required' },
      ...(schoolGeofence ? { school_geofence: schoolGeofence } : {}),
    };
  }

  private isJsonObject(
    value: Prisma.InputJsonValue | undefined,
  ): value is Prisma.InputJsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
