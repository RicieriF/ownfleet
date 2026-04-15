import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import IORedis from 'ioredis';
import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';

/**
 * Custom Socket.IO adapter backed by Redis.
 *
 * Replaces the default in-memory adapter so that events emitted via
 * `server.to(room).emit(...)` are broadcast to clients on ALL API instances,
 * not just the one that processed the request.
 *
 * Usage in main.ts:
 *   const adapter = new RedisIoAdapter(app);
 *   await adapter.connectToRedis(configService.getOrThrow('REDIS_URL'));
 *   app.useWebSocketAdapter(adapter);
 *
 * Note on manual pub/sub in gateways:
 *   Gateways that subscribe to custom Redis channels (e.g. courier_moved,
 *   public:delivery:status) receive the message on EVERY instance. To prevent
 *   duplicate WS events, those handlers must use `server.local.to(room).emit()`
 *   so that each instance only emits to its own connected clients — without
 *   re-broadcasting through the adapter.
 *
 *   Methods called by a single actor (Bull processor, distributed-lock cron) should
 *   continue using `server.to(room).emit()` so the adapter broadcasts to all instances.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor!: ReturnType<typeof createAdapter>;

  constructor(app: INestApplicationContext) {
    super(app);
  }

  /**
   * Establishes two dedicated Redis connections (pub + sub) required by the
   * Socket.IO Redis adapter and waits until both are ready.
   * Must be called before `app.listen()`.
   */
  async connectToRedis(redisUrl: string): Promise<void> {
    const pubClient = new IORedis(redisUrl, { lazyConnect: false });
    const subClient = pubClient.duplicate();

    pubClient.on('error', (err) =>
      this.logger.error('Redis adapter pub client error', err),
    );
    subClient.on('error', (err) =>
      this.logger.error('Redis adapter sub client error', err),
    );

    await Promise.all([
      new Promise<void>((resolve, reject) => {
        pubClient.once('ready', resolve);
        pubClient.once('error', reject);
      }),
      new Promise<void>((resolve, reject) => {
        subClient.once('ready', resolve);
        subClient.once('error', reject);
      }),
    ]);

    this.adapterConstructor = createAdapter(pubClient, subClient);
    this.logger.log('Redis IO adapter connected and ready');
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    server.adapter(this.adapterConstructor);
    return server;
  }
}
