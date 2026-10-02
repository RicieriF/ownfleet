import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type IORedis from 'ioredis';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PassengerTripStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../shared/redis/redis.constants.js';

type FamilyPositionState = 'ONLINE' | 'LAST_KNOWN' | 'OFFLINE';

interface CachedPosition {
  lat: number;
  lng: number;
  ts: number;
}

@Injectable()
export class FamilyTransportService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
  ) {}

  async issueAccessToken(
    guardianId: string,
    ttlDays: number,
    user: AuthenticatedUser,
  ) {
    if (user.courier_id) {
      throw new ForbiddenException('Drivers cannot issue family access tokens');
    }
    if (!Number.isInteger(ttlDays) || ttlDays < 1 || ttlDays > 90) {
      throw new BadRequestException(
        'Family access token TTL must be between 1 and 90 days',
      );
    }
    const guardian = await this.prisma.guardian.findFirst({
      where: {
        id: guardianId,
        establishment_id: user.establishment_id,
        active: true,
      },
      select: { id: true },
    });
    if (!guardian) throw new NotFoundException('Guardian not found');

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + ttlDays * 86_400_000);
    const created = await this.prisma.familyAccessToken.create({
      data: {
        establishment_id: user.establishment_id,
        guardian_id: guardian.id,
        token_hash: this.hash(token),
        expires_at: expiresAt,
      },
      select: { id: true },
    });
    return { id: created.id, token, expires_at: expiresAt };
  }

  async revokeAccessToken(tokenId: string, user: AuthenticatedUser) {
    if (user.courier_id) {
      throw new ForbiddenException(
        'Drivers cannot revoke family access tokens',
      );
    }
    const updated = await this.prisma.familyAccessToken.updateMany({
      where: {
        id: tokenId,
        establishment_id: user.establishment_id,
        revoked_at: null,
      },
      data: { revoked_at: new Date() },
    });
    if (updated.count === 0)
      throw new NotFoundException('Access token not found');
    return { revoked: true };
  }

  async getHome(tripPassengerId: string, rawToken: string | undefined) {
    const access = await this.resolveAccess(rawToken);
    const assignment = await this.prisma.tripPassenger.findFirst({
      where: {
        id: tripPassengerId,
        establishment_id: access.establishment_id,
        passenger: {
          guardians: { some: { guardian_id: access.guardian_id } },
        },
      },
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
          select: { id: true, name: true, address: true, lat: true, lng: true },
        },
        dropoff_stop: {
          select: { id: true, name: true, address: true, lat: true, lng: true },
        },
        trip: {
          select: {
            id: true,
            status: true,
            scheduled_at: true,
            eta_seconds: true,
            distance_meters: true,
            courier_id: true,
            courier: { select: { id: true, name: true, photo_url: true } },
            vehicle: {
              select: {
                id: true,
                name: true,
                plate: true,
                model: true,
                color: true,
                photo_url: true,
              },
            },
          },
        },
        check_events: {
          orderBy: { captured_at: 'desc' },
          take: 10,
          select: {
            id: true,
            type: true,
            validation_status: true,
            captured_at: true,
            guardian: { select: { id: true, name: true } },
            metadata: true,
          },
        },
      },
    });
    if (!assignment) throw new NotFoundException('Trip passenger not found');

    const position = await this.readPosition(assignment.trip.courier_id);
    return {
      trip: {
        id: assignment.trip.id,
        status: assignment.trip.status,
        scheduled_at: assignment.trip.scheduled_at,
        eta_seconds: assignment.trip.eta_seconds,
        distance_meters: assignment.trip.distance_meters,
      },
      passenger: assignment.passenger,
      scheduled_pickup_at: assignment.scheduled_pickup_at,
      ready_at: assignment.ready_at,
      passenger_state: assignment.status,
      boarded_at: assignment.boarded_at,
      dropped_off_at: assignment.dropped_off_at,
      driver: assignment.trip.courier,
      vehicle: assignment.trip.vehicle,
      pickup: assignment.pickup_stop,
      destination: assignment.dropoff_stop,
      vehicle_position: position,
      latest_safety_events: assignment.check_events,
    };
  }

  async markReady(tripPassengerId: string, rawToken: string | undefined) {
    const access = await this.resolveAccess(rawToken);
    const assignment = await this.prisma.tripPassenger.findFirst({
      where: {
        id: tripPassengerId,
        establishment_id: access.establishment_id,
        passenger: {
          guardians: { some: { guardian_id: access.guardian_id } },
        },
      },
      select: { id: true, ready_at: true, status: true },
    });
    if (!assignment) throw new NotFoundException('Trip passenger not found');
    if (assignment.ready_at) return { ready_at: assignment.ready_at };
    if (assignment.status !== PassengerTripStatus.waiting) {
      throw new ConflictException(
        'Passenger readiness can only be set while waiting',
      );
    }

    const readyAt = new Date();
    const updated = await this.prisma.tripPassenger.updateMany({
      where: {
        id: assignment.id,
        establishment_id: access.establishment_id,
        ready_at: null,
      },
      data: { ready_at: readyAt },
    });
    if (updated.count === 0) {
      const winner = await this.prisma.tripPassenger.findFirst({
        where: {
          id: assignment.id,
          establishment_id: access.establishment_id,
        },
        select: { ready_at: true },
      });
      if (!winner?.ready_at) {
        throw new ConflictException('Passenger readiness changed concurrently');
      }
      return { ready_at: winner.ready_at };
    }
    return { ready_at: readyAt };
  }

  private async resolveAccess(rawToken: string | undefined) {
    if (!rawToken)
      throw new UnauthorizedException('Family access token required');
    const access = await this.prisma.familyAccessToken.findUnique({
      where: { token_hash: this.hash(rawToken) },
      select: {
        establishment_id: true,
        guardian_id: true,
        expires_at: true,
        revoked_at: true,
        guardian: { select: { active: true } },
      },
    });
    if (
      !access ||
      access.revoked_at ||
      access.expires_at <= new Date() ||
      !access.guardian.active
    ) {
      throw new UnauthorizedException('Invalid family access token');
    }
    return access;
  }

  private async readPosition(courierId: string) {
    const raw = await this.redis.get(`courier:location:${courierId}`);
    if (!raw) return this.emptyPosition('OFFLINE');
    try {
      const parsed = JSON.parse(raw) as Partial<CachedPosition>;
      if (
        typeof parsed.lat !== 'number' ||
        typeof parsed.lng !== 'number' ||
        typeof parsed.ts !== 'number' ||
        parsed.ts > Date.now() + 30_000
      ) {
        return this.emptyPosition('OFFLINE');
      }
      const ageSeconds = Math.max(
        0,
        Math.floor((Date.now() - parsed.ts) / 1000),
      );
      const state: FamilyPositionState =
        ageSeconds <= 30 ? 'ONLINE' : 'LAST_KNOWN';
      return {
        state,
        lat: parsed.lat,
        lng: parsed.lng,
        captured_at: new Date(parsed.ts).toISOString(),
        age_seconds: ageSeconds,
      };
    } catch {
      return this.emptyPosition('OFFLINE');
    }
  }

  private emptyPosition(state: FamilyPositionState) {
    return {
      state,
      lat: null,
      lng: null,
      captured_at: null,
      age_seconds: null,
    };
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
