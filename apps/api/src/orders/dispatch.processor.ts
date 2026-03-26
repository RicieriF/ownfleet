import { Processor, Process, InjectQueue } from '@nestjs/bull';
import type { Job, Queue } from 'bull';
import { Logger } from '@nestjs/common';
import { OrdersService } from './orders.service.js';

interface DispatchJobData {
  orderId: string;
  establishmentId: string;
  attempt: number;
}

@Processor('dispatch')
export class DispatchProcessor {
  private readonly logger = new Logger(DispatchProcessor.name);

  constructor(
    private readonly ordersService: OrdersService,
    @InjectQueue('dispatch') private readonly dispatchQueue: Queue,
  ) {}

  @Process()
  async handle(job: Job<DispatchJobData>): Promise<void> {
    const { orderId, establishmentId, attempt } = job.data;
    const MAX_ATTEMPTS = 30;

    this.logger.log(`Dispatch attempt ${attempt}/${MAX_ATTEMPTS} for order ${orderId}`);

    const result = await this.ordersService.runDispatchAlgorithm(orderId, establishmentId);

    const assigned = 'recommended' in result;

    if (!assigned && attempt < MAX_ATTEMPTS) {
      await this.dispatchQueue.add(
        { orderId, establishmentId, attempt: attempt + 1 },
        { delay: 60_000, jobId: `dispatch:${orderId}` },
      );
      this.logger.log(`No courier found for ${orderId}, retry scheduled (attempt ${attempt + 1})`);
    } else if (!assigned) {
      this.logger.warn(`Dispatch exhausted for order ${orderId} after ${MAX_ATTEMPTS} attempts`);
    }
  }
}
