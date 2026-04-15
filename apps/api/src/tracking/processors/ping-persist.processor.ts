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
    const { courier_id, lat, lng, battery } = job.data;
    try {
      await this.prisma.$executeRaw`
        INSERT INTO location_pings (id, courier_id, location, battery, created_at)
        VALUES (
          gen_random_uuid(),
          ${courier_id}::uuid,
          ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326),
          ${battery},
          NOW()
        )
      `;
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
