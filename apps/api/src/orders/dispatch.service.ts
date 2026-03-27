import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class DispatchService implements OnModuleInit {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    @InjectQueue('dispatch') private readonly dispatchQueue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  async enqueueDispatch(orderId: string, establishmentId: string): Promise<void> {
    await this.dispatchQueue.add(
      { orderId, establishmentId, attempt: 1 },
      { jobId: `dispatch:${orderId}` },
    );
  }

  async onModuleInit(): Promise<void> {
    // On server restart, requeue pending orders for both 'auto' and 'recommend' modes.
    // 'recommend' mode also uses the queue to find and broadcast courier recommendations.
    const pendingOrders = await this.prisma.order.findMany({
      where: {
        status: 'pending',
        establishment: { dispatch_mode: { in: ['auto', 'recommend'] } },
      },
      select: { id: true, establishment_id: true },
    });

    if (pendingOrders.length > 0) {
      this.logger.log(`Requeuing ${pendingOrders.length} pending orders on startup`);
      for (const order of pendingOrders) {
        await this.enqueueDispatch(order.id, order.establishment_id);
      }
    }
  }
}
