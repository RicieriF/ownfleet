import { BadRequestException } from '@nestjs/common';
import { OrderStatus, DeliveryStatus } from '@prisma/client';

// ─── Order transitions ────────────────────────────────────────────────────────
//  pending → assigned → in_progress → completed
//          ↘ cancelled  ↘ cancelled   ↘ failed

const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['assigned', 'cancelled'],
  assigned: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'failed'],
  completed: [],
  cancelled: [],
  failed: [],
};

// ─── Delivery transitions ─────────────────────────────────────────────────────
//  assigned → in_progress → completed
//                  ↘ failed

const DELIVERY_TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  assigned: ['in_progress'],
  in_progress: ['completed', 'failed'],
  completed: [],
  failed: [],
};

export function assertOrderTransition(
  from: OrderStatus,
  to: OrderStatus,
): void {
  const allowed = ORDER_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new BadRequestException(
      `Invalid order transition: ${from} → ${to}. Allowed: [${allowed.join(', ') || 'none'}]`,
    );
  }
}

export function assertDeliveryTransition(
  from: DeliveryStatus,
  to: DeliveryStatus,
): void {
  const allowed = DELIVERY_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new BadRequestException(
      `Invalid delivery transition: ${from} → ${to}. Allowed: [${allowed.join(', ') || 'none'}]`,
    );
  }
}
