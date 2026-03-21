# @weego CMI — API

NestJS backend for the @weego CMI courier management platform.

## Tech Stack

- **Framework:** NestJS (TypeScript, strict mode)
- **Database:** PostgreSQL 15 + PostGIS via Prisma ORM
- **Cache / Queue / Pub-Sub:** Redis 7 + Bull
- **Auth:** JWT access tokens (15 min) + refresh tokens (30 days, HttpOnly cookie)
- **Push:** Firebase FCM
- **File Storage:** Cloudflare R2 (presigned PUT URLs)

## Setup

```bash
npm install
cp .env.example .env  # fill in required vars
npx prisma migrate dev
npm run start:dev
```

Required environment variables: `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `TELEGRAM_BOT_TOKEN`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`.

## Development

```bash
# watch mode
npm run start:dev

# unit tests
npm run test

# test with coverage
npm run test:cov
```

## API

All endpoints use `/api/v1/` prefix. See `02_Architecture_v1.2.md` at the repo root for full API documentation.

## Modules

| Module | Responsibility |
|--------|---------------|
| `AuthModule` | JWT login/refresh/logout, multi-tenant isolation |
| `EstablishmentsModule` | Establishment CRUD, settings, PlanAccessGuard |
| `CouriersModule` | Courier management, FCM tokens, online status |
| `OrdersModule` | Orders, state machine, courier assignment |
| `TrackingModule` | GPS pings → Redis → WebSocket → dashboard |
| `ProofOfDeliveryModule` | Geo-proof (required) + photo (optional), 300m check |
| `NotificationsModule` | Firebase FCM + Telegram (fire-and-forget) |
| `OnboardingModule` | Courier invite tokens, onboarding status |
| `AnalyticsModule` | Delivery statistics, courier performance |
| `RetentionModule` | Cron cleanup of orders and location pings |
| `IntegrationsModule` | Poster POS webhook + iiko polling |
| `WebhooksModule` | Outbound webhooks with HMAC signing and Bull retry queue |
