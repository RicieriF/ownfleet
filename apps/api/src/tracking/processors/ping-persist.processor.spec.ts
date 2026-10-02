import type { Job } from 'bull';
import type { EtaService } from '../../eta/eta.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { PingJob } from '../tracking.service.js';
import { PingPersistProcessor } from './ping-persist.processor.js';

const jobData: PingJob = {
  event_uid: '11111111-1111-4111-8111-111111111111',
  courier_id: 'courier-1',
  lat: 50.45,
  lng: 30.52,
  battery: 80,
  accuracy: 12,
  captured_at: '2026-10-02T08:00:00.000Z',
};

describe('PingPersistProcessor idempotency', () => {
  it('does not repeat departure side effects for a duplicate event UID', async () => {
    const prisma = { $executeRaw: jest.fn().mockResolvedValue(0) };
    const eta = {
      checkAndMarkDeparture: jest.fn().mockResolvedValue(undefined),
    };
    const processor = new PingPersistProcessor(
      prisma as unknown as PrismaService,
      eta as unknown as EtaService,
    );

    await processor.handle({ data: jobData } as Job<PingJob>);

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(eta.checkAndMarkDeparture).not.toHaveBeenCalled();
  });

  it('runs departure detection once after a new ping is inserted', async () => {
    const prisma = { $executeRaw: jest.fn().mockResolvedValue(1) };
    const eta = {
      checkAndMarkDeparture: jest.fn().mockResolvedValue(undefined),
    };
    const processor = new PingPersistProcessor(
      prisma as unknown as PrismaService,
      eta as unknown as EtaService,
    );

    await processor.handle({ data: jobData } as Job<PingJob>);
    await Promise.resolve();

    expect(eta.checkAndMarkDeparture).toHaveBeenCalledWith(
      'courier-1',
      50.45,
      30.52,
    );
  });
});
