import { EventEmitter } from 'events';

// ── IORedis mock ──────────────────────────────────────────────────────────────
// Hoisted mock must be declared before the import that uses it.

class MockRedisClient extends EventEmitter {
  duplicate = jest.fn(() => new MockRedisClient());
}

const mockIORedisConstructor = jest.fn(() => new MockRedisClient());

jest.mock('ioredis', () => mockIORedisConstructor);

// Import AFTER the mock is declared so the module under test picks up the mock
import { RedisIoAdapter } from '../redis-io.adapter.js';

// ── Helper ────────────────────────────────────────────────────────────────────

const makeApp = () => ({}) as any;

/**
 * Start connectToRedis and, after a tick, emit 'ready' on both pub and sub clients.
 * Returns the pub/sub client pair for further inspection.
 */
async function connectAndResolve(adapter: RedisIoAdapter) {
  const connectPromise = adapter.connectToRedis('redis://localhost:6379');

  // Grab the pub client created by new IORedis() inside connectToRedis
  const pubClient = mockIORedisConstructor.mock.results[
    mockIORedisConstructor.mock.results.length - 1
  ].value as MockRedisClient;
  const subClient = (pubClient.duplicate as jest.Mock).mock.results[0].value as MockRedisClient;

  setImmediate(() => {
    pubClient.emit('ready');
    subClient.emit('ready');
  });

  await connectPromise;
  return { pubClient, subClient };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RedisIoAdapter', () => {
  beforeEach(() => {
    mockIORedisConstructor.mockClear();
    mockIORedisConstructor.mockImplementation(() => new MockRedisClient());
  });

  // ── connectToRedis ──────────────────────────────────────────────────────────

  describe('connectToRedis', () => {
    it('creates pub client via IORedis and sub via duplicate()', async () => {
      const adapter = new RedisIoAdapter(makeApp());
      await connectAndResolve(adapter);

      expect(mockIORedisConstructor).toHaveBeenCalledTimes(1);
      const pubClient = mockIORedisConstructor.mock.results[0].value as MockRedisClient;
      expect(pubClient.duplicate).toHaveBeenCalledTimes(1);
    });

    it('passes the Redis URL to IORedis constructor', async () => {
      const adapter = new RedisIoAdapter(makeApp());
      const connectPromise = adapter.connectToRedis('redis://custom-host:6380');
      const pubClient = mockIORedisConstructor.mock.results[0].value as MockRedisClient;
      const subClient = (pubClient.duplicate as jest.Mock).mock.results[0].value as MockRedisClient;
      setImmediate(() => { pubClient.emit('ready'); subClient.emit('ready'); });
      await connectPromise;

      expect(mockIORedisConstructor).toHaveBeenCalledWith('redis://custom-host:6380', expect.any(Object));
    });

    it('rejects when pub client emits error before ready', async () => {
      const adapter = new RedisIoAdapter(makeApp());
      const connectPromise = adapter.connectToRedis('redis://localhost:6379');
      const pubClient = mockIORedisConstructor.mock.results[0].value as MockRedisClient;
      setImmediate(() => pubClient.emit('error', new Error('Connection refused')));

      await expect(connectPromise).rejects.toThrow('Connection refused');
    });

    it('rejects when sub client emits error before ready', async () => {
      const adapter = new RedisIoAdapter(makeApp());
      const connectPromise = adapter.connectToRedis('redis://localhost:6379');
      const pubClient = mockIORedisConstructor.mock.results[0].value as MockRedisClient;
      const subClient = (pubClient.duplicate as jest.Mock).mock.results[0].value as MockRedisClient;
      setImmediate(() => {
        pubClient.emit('ready');
        subClient.emit('error', new Error('Sub connection refused'));
      });

      await expect(connectPromise).rejects.toThrow('Sub connection refused');
    });
  });

  // ── createIOServer ──────────────────────────────────────────────────────────

  describe('createIOServer', () => {
    it('applies the Redis adapter constructor to the server after connectToRedis', async () => {
      const adapter = new RedisIoAdapter(makeApp());
      await connectAndResolve(adapter);

      const mockServer = { adapter: jest.fn() };
      const superSpy = jest
        .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(adapter)), 'createIOServer')
        .mockReturnValue(mockServer as any);

      adapter.createIOServer(3000, {});

      expect(mockServer.adapter).toHaveBeenCalledTimes(1);
      // The adapter factory is a function returned by createAdapter(pub, sub)
      expect(mockServer.adapter).toHaveBeenCalledWith(expect.any(Function));

      superSpy.mockRestore();
    });

    it('passes through server options to super.createIOServer', async () => {
      const adapter = new RedisIoAdapter(makeApp());
      await connectAndResolve(adapter);

      const mockServer = { adapter: jest.fn() };
      const superSpy = jest
        .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(adapter)), 'createIOServer')
        .mockReturnValue(mockServer as any);

      const opts = { transports: ['websocket'] as any };
      adapter.createIOServer(4000, opts);

      expect(superSpy).toHaveBeenCalledWith(4000, opts);
      superSpy.mockRestore();
    });

    it('still calls server.adapter (with undefined factory) if connectToRedis was not called', () => {
      const adapter = new RedisIoAdapter(makeApp());
      const mockServer = { adapter: jest.fn() };
      const superSpy = jest
        .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(adapter)), 'createIOServer')
        .mockReturnValue(mockServer as any);

      // adapterConstructor is undefined — just verify it doesn't throw in JS land
      expect(() => adapter.createIOServer(3000, {})).not.toThrow();
      expect(mockServer.adapter).toHaveBeenCalledWith(undefined);

      superSpy.mockRestore();
    });
  });
});
