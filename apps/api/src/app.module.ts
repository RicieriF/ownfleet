import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { EstablishmentsModule } from './establishments/establishments.module.js';
import { CouriersModule } from './couriers/couriers.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { TrackingModule } from './tracking/tracking.module.js';
import { ProofOfDeliveryModule } from './proof-of-delivery/proof-of-delivery.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { RetentionModule } from './retention/retention.module.js';
import { IntegrationsModule } from './integrations/integrations.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    EstablishmentsModule,
    CouriersModule,
    OrdersModule,
    TrackingModule,
    ProofOfDeliveryModule,
    NotificationsModule,
    RetentionModule,
    IntegrationsModule,
  ],
})
export class AppModule {}
