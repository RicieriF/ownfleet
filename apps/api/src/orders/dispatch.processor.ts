import { Processor, Process, InjectQueue } from '@nestjs/bull';
import type { Job, Queue } from 'bull';
import { Logger } from '@nestjs/common';
import { OrdersService } from './orders.service.js';
import { TrackingGateway } from '../tracking/tracking.gateway.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TelegramService } from '../telegram/telegram.service.js';
import { MANAGER_EVENT } from '../telegram/telegram.types.js';

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
    private readonly telegram: TelegramService,
    @InjectQueue('dispatch') private readonly dispatchQueue: Queue,
  ) {}

  @Process()
  async handle(job: Job<DispatchJobData>): Promise<void> {
    const { orderId, establishmentId, attempt } = job.data;
    const MAX_ATTEMPTS = 30;

    this.logger.log(
      `Dispatch attempt ${attempt}/${MAX_ATTEMPTS} for order ${orderId}`,
    );

    const result = await this.ordersService.runDispatchAlgorithm(
      orderId,
      establishmentId,
    );

    const assigned = 'recommended' in result;

    if (assigned) {
      // For `recommend` mode — broadcast recommendation so the manager's dashboard
      // can show the SmartAssignmentPanel with a one-click confirm button.
      // `auto` mode assigns immediately inside runDispatchAlgorithm itself.
      // dispatchMode is included in the result to avoid a second DB round-trip.
      if (result.dispatchMode === 'recommend') {
        const { recommended } = result;
        try {
          this.gateway.broadcastToEstablishment(
            establishmentId,
            'order:recommendation',
            {
              order_id: orderId,
              courier_id: recommended.courierId,
              courier_name: recommended.name,
              eta_seconds: recommended.etaSeconds,
              distance_meters: recommended.distanceMeters,
              transport_mode: recommended.transportMode,
            },
          );
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
      this.logger.log(
        `No courier found for ${orderId}, retry scheduled (attempt ${attempt + 1})`,
      );

      // Alert managers after 5 failed attempts (~5 min) — early warning so they can act fast.
      // Sent only once: attempt === 5 prevents duplicate alerts on subsequent retries.
      if (attempt === 5) {
        this.prisma.order
          .findUnique({ where: { id: orderId }, select: { address: true } })
          .then((order) => {
            const addr = order?.address ?? orderId;
            this.telegram
              .notifyEstablishmentManagers(
                establishmentId,
                `🚨 Немає курʼєра для замовлення\nАдреса: ${addr}\nАвтодиспетчер шукає вже ~5 хв. Призначте вручну або дочекайтесь поки курʼєр звільниться.`,
                MANAGER_EVENT.DISPATCH_NO_COURIER,
              )
              .catch((err: unknown) =>
                this.logger.warn(
                  'Telegram dispatch_no_courier alert failed',
                  err,
                ),
              );
          })
          .catch((err: unknown) =>
            this.logger.warn(
              'Could not look up order address for dispatch alert',
              err,
            ),
          );
      }
    } else if (!assigned) {
      this.logger.warn(
        `Dispatch exhausted for order ${orderId} after ${MAX_ATTEMPTS} attempts`,
      );
    }
  }
}
