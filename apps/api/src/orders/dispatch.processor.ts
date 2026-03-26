import { Processor, Process, InjectQueue } from '@nestjs/bull';
import type { Job, Queue } from 'bull';
import { Logger } from '@nestjs/common';
import { OrdersService } from './orders.service.js';
import { TrackingGateway } from '../tracking/tracking.gateway.js';
import { PrismaService } from '../prisma/prisma.service.js';

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
    private readonly gateway: TrackingGateway,
    private readonly prisma: PrismaService,
    @InjectQueue('dispatch') private readonly dispatchQueue: Queue,
  ) {}

  @Process()
  async handle(job: Job<DispatchJobData>): Promise<void> {
    const { orderId, establishmentId, attempt } = job.data;
    const MAX_ATTEMPTS = 30;

    this.logger.log(`Dispatch attempt ${attempt}/${MAX_ATTEMPTS} for order ${orderId}`);

    const result = await this.ordersService.runDispatchAlgorithm(orderId, establishmentId);

    const assigned = 'recommended' in result;

    if (assigned) {
      // For `recommend` mode — broadcast recommendation so the manager's dashboard
      // can show the SmartAssignmentPanel with a one-click confirm button.
      // `auto` mode assigns immediately inside runDispatchAlgorithm itself.
      const establishment = await this.prisma.establishment.findUnique({
        where: { id: establishmentId },
        select: { dispatch_mode: true },
      });

      if (establishment?.dispatch_mode === 'recommend') {
        const { recommended } = result;
        try {
          this.gateway.broadcastToEstablishment(establishmentId, 'order:recommendation', {
            order_id: orderId,
            courier_id: recommended.courierId,
            courier_name: recommended.name,
            eta_seconds: recommended.etaSeconds,
            distance_meters: recommended.distanceMeters,
            transport_mode: recommended.transportMode,
          });
        } catch (err) {
          this.logger.warn('WS broadcast failed for order:recommendation', err);
        }
      }
    }

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
