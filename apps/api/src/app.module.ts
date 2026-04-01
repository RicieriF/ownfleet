import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { ThrottlerModule } from '@nestjs/throttler';
import { UserAwareThrottlerGuard } from './common/guards/user-aware-throttler.guard.js';
import { APP_GUARD } from '@nestjs/core';
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
import { ShiftsModule } from './shifts/shifts.module.js';
import { PlatformModule } from './platform/platform.module.js';
import { TelegramModule } from './telegram/telegram.module.js';
import { GeocodingModule } from './geocoding/geocoding.module.js';
import { SharedRedisModule } from './shared/redis/redis.module.js';
import { ApiKeysModule } from './api-keys/api-keys.module.js';
import { PublicTrackingModule } from './public-tracking/public-tracking.module.js';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Global rate limiting: 120 req / 60 s per user ID (authenticated) or IP (unauthenticated)
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: config.getOrThrow<string>('REDIS_URL'),
      }),
    }),
    SharedRedisModule,
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
    ShiftsModule,
    PlatformModule,
    TelegramModule,
    GeocodingModule,
    ApiKeysModule,
    PublicTrackingModule,
  ],
  controllers: [HealthController],
  providers: [
    // Apply UserAwareThrottlerGuard globally — keys on user ID for authenticated routes, IP for unauthenticated
    { provide: APP_GUARD, useClass: UserAwareThrottlerGuard },
  ],
})
export class AppModule {}
