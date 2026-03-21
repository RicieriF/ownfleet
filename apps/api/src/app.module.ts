import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
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
import { OnboardingModule } from './onboarding/onboarding.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { WebhooksModule } from './webhooks/webhooks.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: config.getOrThrow<string>('REDIS_URL'),
      }),
    }),
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
    OnboardingModule,
    AnalyticsModule,
    WebhooksModule,
  ],
})
export class AppModule {}
