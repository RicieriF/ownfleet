import { PublicTrackingGateway, DisconnectJob } from '../public-tracking.gateway.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RedisSubscriberFactory } from '../../shared/redis/redis-subscriber.factory.js';
import type { Queue, Job } from 'bull';

// ── Minimal mocks ─────────────────────────────────────────────────────────────

const toChain = { emit: jest.fn() };
const inChain = { disconnectSockets: jest.fn() };
const mockServer = {
  to: jest.fn().mockReturnValue(toChain),
  in: jest.fn().mockReturnValue(inChain),
};

const mockRedis = {
  del: jest.fn().mockResolvedValue(1),
  publish: jest.fn().mockResolvedValue(1),
};

const mockRedisSub = {
  psubscribe: jest.fn(),
  subscribe: jest.fn(),
  on: jest.fn(),
  disconnect: jest.fn(),
};

const mockRedisSubscriberFactory = {
  create: jest.fn().mockReturnValue(mockRedisSub),
};

const mockPrisma = {
  trackingToken: {
    findUnique: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
};

const mockQueue = {
  add: jest.fn().mockResolvedValue({}),
} as unknown as Queue<DisconnectJob>;

function makeJob(data: DisconnectJob): Job<DisconnectJob> {
  return { data } as Job<DisconnectJob>;
}

function makeGateway(): PublicTrackingGateway {
  const gw = new PublicTrackingGateway(
    mockPrisma as unknown as PrismaService,
    mockRedisSubscriberFactory as unknown as RedisSubscriberFactory,
    mockRedis as any,
    mockQueue,
  );
  // Inject the mocked WS server
  (gw as any).server = mockServer;
  return gw;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('PublicTrackingGateway.processDisconnect', () => {
  let gw: PublicTrackingGateway;

  beforeEach(() => {
    gw = makeGateway();
    jest.clearAllMocks();
    mockServer.to.mockReturnValue(toChain);
    mockServer.in.mockReturnValue(inChain);
    mockRedis.del.mockResolvedValue(1);
  });

  // ── completed reason ──────────────────────────────────────────────────────

  it('emits TOKEN_EXPIRED and disconnects sockets for reason=completed', async () => {
    const job = makeJob({ orderId: 'order-1', deliveryId: 'del-1', reason: 'completed' });
    await gw.processDisconnect(job);

    expect(mockServer.to).toHaveBeenCalledWith('order:order-1:public');
    expect(toChain.emit).toHaveBeenCalledWith('error', { type: 'TOKEN_EXPIRED' });

    expect(mockServer.in).toHaveBeenCalledWith('order:order-1:public');
    expect(inChain.disconnectSockets).toHaveBeenCalledWith(true);
  });

  it('deletes Redis route and active_order keys for reason=completed', async () => {
    const job = makeJob({ orderId: 'order-1', deliveryId: 'del-abc', reason: 'completed', courierId: 'c-1' });
    await gw.processDisconnect(job);

    expect(mockRedis.del).toHaveBeenCalledWith('route:origin:del-abc');
    expect(mockRedis.del).toHaveBeenCalledWith('route:del-abc');
    expect(mockRedis.del).toHaveBeenCalledWith('courier:active_order:c-1');
  });

  // ── terminal reason ───────────────────────────────────────────────────────

  it('does NOT emit TOKEN_EXPIRED for reason=terminal (cancelled/failed)', async () => {
    const job = makeJob({ orderId: 'order-2', deliveryId: '', reason: 'terminal' });
    await gw.processDisconnect(job);

    // server.to should never be called for TOKEN_EXPIRED emission
    expect(toChain.emit).not.toHaveBeenCalled();
  });

  it('still disconnects sockets for reason=terminal', async () => {
    const job = makeJob({ orderId: 'order-2', deliveryId: '', reason: 'terminal' });
    await gw.processDisconnect(job);

    expect(mockServer.in).toHaveBeenCalledWith('order:order-2:public');
    expect(inChain.disconnectSockets).toHaveBeenCalledWith(true);
  });

  it('does NOT call Redis DEL for reason=terminal (no deliveryId)', async () => {
    const job = makeJob({ orderId: 'order-2', deliveryId: '', reason: 'terminal' });
    await gw.processDisconnect(job);

    expect(mockRedis.del).not.toHaveBeenCalled();
  });
});

// ── handleDeliveryCompleted (via private — tested through side effects) ────────

describe('PublicTrackingGateway — handleDeliveryCompleted side effects', () => {
  let gw: PublicTrackingGateway;

  beforeEach(() => {
    gw = makeGateway();
    jest.clearAllMocks();
    mockQueue.add = jest.fn().mockResolvedValue({});
    mockPrisma.trackingToken.updateMany.mockResolvedValue({ count: 1 });
  });

  it('shortens tracking token TTL and schedules completed disconnect job', async () => {
    // Call private method directly — acceptable for lifecycle-critical logic
    const handleDeliveryCompleted = (gw as any)['handleDeliveryCompleted'].bind(gw) as
      (payload: { orderId: string; deliveryId: string; courierId: string }) => Promise<void>;

    await handleDeliveryCompleted({ orderId: 'order-3', deliveryId: 'del-3', courierId: 'courier-1' });

    // TTL was shortened
    expect(mockPrisma.trackingToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { order_id: 'order-3' } }),
    );

    // Disconnect job was scheduled with reason='completed' and courierId for fallback cleanup
    expect(mockQueue.add).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-3', deliveryId: 'del-3', reason: 'completed', courierId: 'courier-1' }),
      expect.objectContaining({ jobId: 'disconnect:order-3' }),
    );
  });
});
