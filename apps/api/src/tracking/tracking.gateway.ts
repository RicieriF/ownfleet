import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { RedisSubscriberFactory } from '../shared/redis/redis-subscriber.factory.js';
import type IORedis from 'ioredis';
import type { JwtPayload } from '../auth/auth.types.js';
import type { CourierMovedEvent } from './tracking.service.js';
import {
  GEOCODING_DONE_CHANNEL,
  GEOCODING_FAILED_CHANNEL,
} from '../geocoding/geocoding.constants.js';
import type {
  GeocodingDonePayload,
  GeocodingFailedPayload,
} from '../geocoding/processors/geocoding.processor.js';

const PUBSUB_CHANNEL = 'courier_moved';

@Injectable()
@WebSocketGateway({ namespace: '/' })
export class TrackingGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleInit
{
  @WebSocketServer()
  private server!: Server;

  private readonly logger = new Logger(TrackingGateway.name);
  private redisSub!: IORedis;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly redisSubscriberFactory: RedisSubscriberFactory,
  ) {}

  afterInit(server: Server): void {
    const raw = this.config.get<string>('ALLOWED_ORIGINS') ?? '';
    const origins = raw
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);

    const engine = (
      server as unknown as { engine?: { opts?: Record<string, unknown> } }
    ).engine;
    if (engine?.opts) {
      engine.opts['cors'] = {
        origin: origins.length > 0 ? origins : false,
        credentials: true,
      };
    }

    this.logger.log(
      `WebSocket gateway initialized — CORS origins: [${origins.join(', ') || '*'}]`,
    );
  }

  onModuleInit(): void {
    this.redisSub = this.redisSubscriberFactory.create();

    this.redisSub.subscribe(
      PUBSUB_CHANNEL,
      GEOCODING_DONE_CHANNEL,
      GEOCODING_FAILED_CHANNEL,
      (err) => {
        if (err) this.logger.error('Redis subscribe failed', err);
      },
    );

    this.redisSub.on('message', (channel: string, message: string) => {
      try {
        if (channel === PUBSUB_CHANNEL) {
          const event = JSON.parse(message) as CourierMovedEvent;
          const room = `est:${event.establishment_id}`;
          // server.local: emit only to clients on THIS instance.
          // All instances subscribe to the same Redis channel, so each handles
          // its own connected clients. Without .local, the Redis adapter would
          // re-broadcast across instances and each client would receive N copies.
          this.server.local.to(room).emit('courier:moved', {
            courier_id: event.courier_id,
            lat: event.lat,
            lng: event.lng,
            battery: event.battery,
            ts: event.ts,
          });
        } else if (channel === GEOCODING_DONE_CHANNEL) {
          const payload = JSON.parse(message) as GeocodingDonePayload;
          const room = `est:${payload.establishmentId}`;
          this.server.local.to(room).emit('order:coords_ready', {
            order_id: payload.orderId,
            lat: payload.lat,
            lng: payload.lng,
          });
        } else if (channel === GEOCODING_FAILED_CHANNEL) {
          const payload = JSON.parse(message) as GeocodingFailedPayload;
          const room = `est:${payload.establishmentId}`;
          // Dashboard listens for this event to show an immediate alert
          // without waiting for a page refresh.
          this.server.local.to(room).emit('order:geocode_failed', {
            order_id: payload.orderId,
            address: payload.address,
            reason: payload.reason,
          });
        }
      } catch (err) {
        this.logger.error('Failed to parse pubsub event', err);
      }
    });
  }

  handleConnection(socket: Socket): void {
    try {
      const token =
        (socket.handshake.auth as Record<string, string>)['token'] ??
        (socket.handshake.headers['authorization'] ?? '').replace(
          'Bearer ',
          '',
        );

      if (!token) {
        this.logger.warn(`WS rejected — no token (${socket.id})`);
        socket.disconnect(true);
        return;
      }

      const payload = this.jwt.verify<JwtPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });

      const room = `est:${payload.establishment_id}`;
      void socket.join(room);
      this.logger.log(`WS connected: ${socket.id} → room ${room}`);
    } catch {
      this.logger.warn(`WS rejected — invalid token (${socket.id})`);
      socket.disconnect(true);
    }
  }

  handleDisconnect(socket: Socket): void {
    this.logger.log(`WS disconnected: ${socket.id}`);
  }

  // ── Public API for other services to broadcast establishment-scoped events ─

  broadcastToEstablishment(
    establishmentId: string,
    event: string,
    data: unknown,
  ): void {
    const room = `est:${establishmentId}`;
    this.server.to(room).emit(event, data);
  }
}
