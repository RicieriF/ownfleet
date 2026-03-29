import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Cron } from '@nestjs/schedule';
import type { Queue, Job } from 'bull';
import type IORedis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisSubscriberFactory } from '../shared/redis/redis-subscriber.factory.js';
import { REDIS_CLIENT } from '../shared/redis/redis.constants.js';
import {
  TRACKING_DISCONNECT_QUEUE,
  PUBLIC_DELIVERY_STATUS_CHANNEL,
  PUBLIC_DELIVERY_COMPLETED_CHANNEL,
  TRACKING_TOKEN_POST_DELIVERY_MINUTES,
} from './public-tracking.constants.js';
import { GEOCODING_DONE_CHANNEL, GeocodingDonePayload } from '../geocoding/processors/geocoding.processor.js';
import { Processor, Process } from '@nestjs/bull';

export interface DisconnectJob {
  orderId: string;
  deliveryId: string;
}

export interface DeliveryStatusPayload {
  orderId: string;
  orderStatus: string;
  deliveryStatus: string | null;
}

export interface DeliveryCompletedPayload {
  orderId: string;
  deliveryId: string;
  courierId: string;
}

/** Redis pub/sub pattern for courier location/route events from TrackingService */
const LOCATION_PATTERN = 'order:*:public';

@Injectable()
@Processor(TRACKING_DISCONNECT_QUEUE)
@WebSocketGateway({ namespace: '/public', cors: { origin: '*' } })
export class PublicTrackingGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  @WebSocketServer()
  private server!: Server;

  private readonly logger = new Logger(PublicTrackingGateway.name);
  private redisSub!: IORedis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisSubscriberFactory: RedisSubscriberFactory,
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
    @InjectQueue(TRACKING_DISCONNECT_QUEUE) private readonly disconnectQueue: Queue<DisconnectJob>,
  ) {}

  afterInit(_server: Server): void {
    this.logger.log('Public WebSocket gateway (/public) initialized');
  }

  onModuleInit(): void {
    this.redisSub = this.redisSubscriberFactory.create();

    // Pattern subscribe for courier location/route events
    this.redisSub.psubscribe(LOCATION_PATTERN, (err) => {
      if (err) this.logger.error('psubscribe failed', err);
    });

    // Regular subscribe for delivery lifecycle events
    this.redisSub.subscribe(
      GEOCODING_DONE_CHANNEL,
      PUBLIC_DELIVERY_STATUS_CHANNEL,
      PUBLIC_DELIVERY_COMPLETED_CHANNEL,
      (err) => {
        if (err) this.logger.error('subscribe failed', err);
      },
    );

    // Pattern messages (courier location / route)
    this.redisSub.on('pmessage', (_pattern: string, channel: string, message: string) => {
      try {
        const payload = JSON.parse(message) as { type: string; [key: string]: unknown };
        // channel = 'order:{orderId}:public'
        const parts = channel.split(':');
        const orderId = parts[1];
        if (!orderId) return;

        const room = `order:${orderId}:public`;
        if (payload.type === 'location') {
          this.server.to(room).emit('courier:location', { lat: payload['lat'], lng: payload['lng'] });
        } else if (payload.type === 'route') {
          this.server.to(room).emit('delivery:route', { routeGeometry: payload['routeGeometry'] });
        }
      } catch (err) {
        this.logger.error('Failed to handle pmessage', err);
      }
    });

    // Regular messages (delivery lifecycle, geocoding)
    this.redisSub.on('message', (channel: string, message: string) => {
      try {
        if (channel === GEOCODING_DONE_CHANNEL) {
          const payload = JSON.parse(message) as GeocodingDonePayload;
          this.server
            .to(`order:${payload.orderId}:public`)
            .emit('order:coords_ready', { lat: payload.lat, lng: payload.lng });
          return;
        }

        if (channel === PUBLIC_DELIVERY_STATUS_CHANNEL) {
          const payload = JSON.parse(message) as DeliveryStatusPayload;
          this.server
            .to(`order:${payload.orderId}:public`)
            .emit('delivery:status', {
              orderStatus: payload.orderStatus,
              deliveryStatus: payload.deliveryStatus,
            });
          return;
        }

        if (channel === PUBLIC_DELIVERY_COMPLETED_CHANNEL) {
          const payload = JSON.parse(message) as DeliveryCompletedPayload;
          void this.handleDeliveryCompleted(payload);
          return;
        }
      } catch (err) {
        this.logger.error('Failed to handle message', err);
      }
    });
  }

  onModuleDestroy(): void {
    if (this.redisSub) {
      this.redisSub.disconnect();
    }
  }

  // ── WS connection lifecycle ─────────────────────────────────────────────

  async handleConnection(socket: Socket): Promise<void> {
    try {
      const token =
        (socket.handshake.auth as Record<string, string>)['token'] ?? '';

      if (!token || token.length > 64) {
        socket.disconnect(true);
        return;
      }

      const trackingToken = await this.prisma.trackingToken.findUnique({
        where: { token },
        select: { order_id: true, expires_at: true },
      });

      if (!trackingToken || trackingToken.expires_at < new Date()) {
        socket.emit('error', { type: 'TOKEN_EXPIRED' });
        socket.disconnect(true);
        return;
      }

      const room = `order:${trackingToken.order_id}:public`;
      await socket.join(room);
      this.logger.log(`Public WS connected: ${socket.id} → room ${room}`);
    } catch (err) {
      this.logger.error('Public WS connection error', err);
      socket.disconnect(true);
    }
  }

  handleDisconnect(socket: Socket): void {
    this.logger.log(`Public WS disconnected: ${socket.id}`);
  }

  // ── Delivery completed lifecycle ────────────────────────────────────────

  private async handleDeliveryCompleted(payload: DeliveryCompletedPayload): Promise<void> {
    const { orderId, deliveryId } = payload;

    // Async update: shorten token TTL to 15 min post-completion.
    // Intentionally NOT in the same transaction as the delivery update (module isolation).
    const shortExpiry = new Date(
      Date.now() + TRACKING_TOKEN_POST_DELIVERY_MINUTES * 60 * 1000,
    );
    this.prisma.trackingToken
      .updateMany({
        where: { order_id: orderId },
        data: { expires_at: shortExpiry },
      })
      .catch((err: unknown) => this.logger.warn('Failed to shorten tracking token TTL', err));

    // Schedule Bull delayed disconnect after 15 min (survives server restarts)
    await this.disconnectQueue
      .add(
        { orderId, deliveryId },
        {
          delay: TRACKING_TOKEN_POST_DELIVERY_MINUTES * 60 * 1000,
          jobId: `disconnect:${orderId}`,
          removeOnComplete: true,
        },
      )
      .catch((err) => this.logger.warn('Failed to schedule WS disconnect job', err));
  }

  // ── Bull processor: delayed disconnect ─────────────────────────────────

  @Process()
  async processDisconnect(job: Job<DisconnectJob>): Promise<void> {
    const { orderId, deliveryId } = job.data;

    // Emit TOKEN_EXPIRED before disconnecting so client can show final state
    this.server
      .to(`order:${orderId}:public`)
      .emit('error', { type: 'TOKEN_EXPIRED' });

    // Disconnect all sockets in the room
    this.server.in(`order:${orderId}:public`).disconnectSockets(true);

    // DEL Redis keys (route data)
    await Promise.all([
      this.redis.del(`route:origin:${deliveryId}`).catch(() => {}),
      this.redis.del(`route:${deliveryId}`).catch(() => {}),
    ]);

    this.logger.log(`Disconnected public WS room for order ${orderId}`);
  }

  // ── ETA push cron (every 60s) ────────────────────────────────────────────

  @Cron('*/60 * * * * *', { name: 'public-eta-push', timeZone: 'UTC' })
  async pushEtaEvents(): Promise<void> {
    const deliveries = await this.prisma.delivery.findMany({
      where: { status: 'in_progress' },
      select: {
        id: true,
        eta_seconds: true,
        eta_started_at: true,
        order_id: true,
      },
    });

    for (const d of deliveries) {
      if (d.eta_seconds === null) continue;

      let remainingSeconds = d.eta_seconds;
      if (d.eta_started_at) {
        const elapsedSeconds = Math.floor((Date.now() - d.eta_started_at.getTime()) / 1000);
        remainingSeconds = Math.max(0, d.eta_seconds - elapsedSeconds);
      }

      this.server
        .to(`order:${d.order_id}:public`)
        .emit('delivery:eta', { etaSeconds: remainingSeconds });
    }
  }
}
