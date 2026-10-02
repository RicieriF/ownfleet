import { Logger } from '@nestjs/common';
import { Processor, Process } from '@nestjs/bull';
import type { Job } from 'bull';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EtaService } from '../../eta/eta.service.js';
import { PING_PERSIST_QUEUE, PingJob } from '../tracking.service.js';

@Processor(PING_PERSIST_QUEUE)
export class PingPersistProcessor {
  private readonly logger = new Logger(PingPersistProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly etaService: EtaService,
  ) {}

  @Process()
  async handle(job: Job<PingJob>): Promise<void> {
    const { event_uid, courier_id, lat, lng, battery, accuracy, captured_at } =
      job.data;
    try {
      const inserted = await this.prisma.$executeRaw`
        INSERT INTO location_pings (
          id, event_uid, courier_id, location, battery, accuracy, captured_at, created_at
        )
        VALUES (
          gen_random_uuid(),
          ${event_uid},
          ${courier_id}::uuid,
          ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326),
          ${battery},
          ${accuracy},
          ${new Date(captured_at)},
          ${new Date(captured_at)}
        )
        ON CONFLICT (event_uid) DO NOTHING
      `;
      if (inserted === 0) return;
    } catch (err) {
      this.logger.error(
        `Failed to persist ping for courier ${courier_id}`,
        err,
      );
      throw err; // rethrow so Bull marks the job as failed and can retry
    }

    // Fire-and-forget: check if courier has departed 100m from establishment
    // to start the ETA countdown timer
    this.etaService
      .checkAndMarkDeparture(courier_id, lat, lng)
      .catch((err) =>
        this.logger.warn(
          `checkAndMarkDeparture failed for courier ${courier_id}`,
          err,
        ),
      );
  }
}
