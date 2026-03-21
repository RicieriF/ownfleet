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
import { InjectRedisSubscriber } from './redis.provider.js';
import type { Redis } from 'ioredis';
import type { JwtPayload } from '../auth/auth.types.js';
import type { CourierMovedEvent } from './tracking.service.js';

const PUBSUB_CHANNEL = 'courier_moved';

@Injectable()
@WebSocketGateway({ namespace: '/' })
export class TrackingGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  @WebSocketServer()
  private server!: Server;

  private readonly logger = new Logger(TrackingGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @InjectRedisSubscriber() private readonly redisSub: Redis,
  ) {}

  afterInit(server: Server): void {
    // Apply CORS after init so we can read the env variable.
    // ALLOWED_ORIGINS is a comma-separated list, e.g. "https://app.weego.ua,https://admin.weego.ua"
    const raw = this.config.get<string>('ALLOWED_ORIGINS') ?? '';
    const origins = raw
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);

    // server.engine may not be available in all Socket.IO versions / adapter combos.
    // When present, apply CORS dynamically; otherwise the decorator-level CORS applies.
    const engine = (server as unknown as { engine?: { opts?: Record<string, unknown> } }).engine;
    if (engine?.opts) {
      engine.opts['cors'] = {
        origin: origins.length > 0 ? origins : false,
        credentials: true,
      };
    }

    this.logger.log(`WebSocket gateway initialized — CORS origins: [${origins.join(', ') || '*'}]`);
  }

  onModuleInit(): void {
    // Subscribe to Redis pub/sub once on startup
    this.redisSub.subscribe(PUBSUB_CHANNEL, (err) => {
      if (err) this.logger.error('Redis subscribe failed', err);
    });

    this.redisSub.on('message', (_channel: string, message: string) => {
      try {
        const event = JSON.parse(message) as CourierMovedEvent;
        // Fan-out only to the room of the relevant establishment
        const room = `est:${event.establishment_id}`;
        this.server.to(room).emit('courier_moved', {
          courier_id: event.courier_id,
          lat: event.lat,
          lng: event.lng,
          battery: event.battery,
          ts: event.ts,
        });
      } catch (err) {
        this.logger.error('Failed to parse courier_moved event', err);
      }
    });
  }

  handleConnection(socket: Socket): void {
    try {
      const token =
        (socket.handshake.auth as Record<string, string>)['token'] ??
        (socket.handshake.headers['authorization'] ?? '').replace('Bearer ', '');

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
}
