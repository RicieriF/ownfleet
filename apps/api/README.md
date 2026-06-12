# OwnFleet — API

NestJS backend for the OwnFleet courier management platform.

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
| `AuthModule` | JWT login/refresh/logout, ws-token (60s), multi-tenant isolation |
| `EstablishmentsModule` | Establishment CRUD, settings, PlanAccessGuard, dispatch_mode |
| `CouriersModule` | Courier management, FCM tokens, workload-today Redis cache |
| `ShiftsModule` | Shifts: start/end, auto-close (16h), Telegram reminders |
| `OrdersModule` | Orders, state machine, dispatch algorithm (manual/recommend/auto), ETA |
| `TrackingModule` | GPS pings → Redis → WebSocket → dashboard, departure detection |
| `EtaModule` | OSRM routing, ETA calculation, 5 transport modes, overdue alerts |
| `ProofOfDeliveryModule` | Geo-proof (required) + photo (optional), 300m check |
| `NotificationsModule` | Firebase FCM + Telegram (fire-and-forget) |
| `OnboardingModule` | Courier invite tokens, transport mode selection |
| `AnalyticsModule` | Delivery statistics, courier performance |
| `RetentionModule` | Cron: order/ping cleanup, auto-close shifts, ETA overdue, courier alerts |
| `IntegrationsModule` | Poster POS webhook + iiko polling |
| `WebhooksModule` | Outbound webhooks with HMAC signing and Bull retry queue |
