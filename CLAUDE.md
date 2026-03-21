# @weego CMI — CLAUDE.md

> Цей файл читається автоматично на початку кожної сесії Claude Code.
> Не видаляти. Оновлювати при зміні архітектурних рішень.

---

## Що це за продукт

B2B SaaS платформа для управління власними курʼєрами закладів доставки (ресторани, кафе, піцерії) в Україні. Три компоненти: мобільний додаток курʼєра, веб-дашборд менеджера, REST+WebSocket API.

Повна архітектура: `02_Architecture_v1.2.md` (1800+ рядків).
Продуктове бачення: `01_Product_Vision.md`.

---

## Tech Stack

| Шар | Технологія |
|-----|------------|
| Backend | NestJS (TypeScript), Prisma ORM |
| Database | PostgreSQL 15 + PostGIS |
| Cache / Queue / Pub-Sub | Redis 7 + Bull (@nestjs/bull) |
| Mobile (курʼєр) | React Native + Expo SDK 51 |
| Web (менеджер) | Next.js 14 App Router + shadcn/ui + Tailwind |
| Maps | Leaflet + OpenStreetMap |
| File Storage | Cloudflare R2 (S3-сумісний, presigned URLs) |
| Push | Firebase FCM |
| Notifications | Telegram Bot (fire-and-forget, side-channel) |
| Auth | JWT (access 15хв) + Refresh tokens (30 днів, HttpOnly cookie) |

---

## Архітектурний патерн

**Modular Monolith** — один NestJS застосунок, чіткі межі між модулями (bounded contexts). Модулі НЕ імпортують один одного напряму — тільки через сервіси або події.

**Multi-tenancy:** `establishment_id` присутній у кожній таблиці. JWT payload містить `{ sub: userId, establishment_id, role }`. Middleware перевіряє ізоляцію тенанта на кожному запиті.

**API versioning:** всі endpoints — `/api/v1/` prefix.

---

## Модулі (NestJS)

| Модуль | Відповідальність |
|--------|-----------------|
| `AuthModule` | JWT login/refresh/logout, tenant isolation |
| `EstablishmentsModule` | CRUD закладів, settings, PlanAccessGuard |
| `CouriersModule` | Управління курʼєрами, FCM tokens, статус онлайн |
| `OrdersModule` | Замовлення, state machine, призначення курʼєра |
| `TrackingModule` | GPS пінги → Redis → WebSocket → дашборд |
| `ProofOfDeliveryModule` | Гео-пруф (обовʼязк.) + фото (опц.), 300м перевірка |
| `RetentionModule` | Cron очищення orders + location_pings |
| `IntegrationsModule` | Poster POS webhook + iiko polling |
| `WebhooksModule` | Outbound webhooks з HMAC, Bull retry queue |
| `NotificationsModule` | FCM push + Telegram (завжди fire-and-forget) |
| `OnboardingModule` | Invite tokens для курʼєрів, onboarding статус |
| `AnalyticsModule` | Статистика доставок та ефективності |

---

## Схема БД (скорочено)

```sql
establishments  (id, name, plan, trial_ends_at, paid_until, onboarding_status, settings JSONB)
users           (id, establishment_id, role CHECK IN ('owner','manager','dispatcher'), email, password_hash, courier_id UNIQUE, is_platform_admin)
couriers        (id, establishment_id, name, phone, device_token, device_platform, active,
                 battery_optimization_exempt, device_brand, last_reminder_sent_at, reminder_count)
orders          (id, establishment_id, external_id, address, lat, lng, status, source, created_at)
                UNIQUE(external_id, establishment_id)
deliveries      (id, order_id, courier_id, status, assigned_at, assignment_timeout_at,
                 started_at, completed_at, order_closed_at, proof_id)
delivery_proofs (id, delivery_id, lat, lng, captured_at, order_closed_at, photo_key,
                 geo_match, accuracy, geo_flags JSONB)  -- НІКОЛИ не видаляється
location_pings  (id, courier_id, location GEOMETRY(Point,4326), battery, created_at)
integrations    (id, establishment_id, type, config JSONB, active)
webhooks        (id, establishment_id, url, secret, events TEXT[], active,
                 consecutive_failures INT, last_error, last_error_at)
invite_tokens   (id, establishment_id, token, courier_id, expires_at, used_at)
retention_logs  (id, establishment_id, deleted_orders, deleted_pings, run_at)
billing_events  (id, establishment_id, type, amount_usd, notes, created_at)
```

---

## State Machines (КРИТИЧНО — не змінювати без обговорення)

**Orders:**
```
pending → assigned → in_progress → completed
        ↘ cancelled  ↘ cancelled   ↘ failed
```

**Deliveries:**
```
assigned → in_progress → completed
                ↘ failed
```

Переходи тільки через явні методи state machine. Жодних прямих `UPDATE SET status=...` в обхід guards.

---

## Правила коду

- **TypeScript strict mode** — ніяких `any`, ніяких `@ts-ignore`
- **Zod** — валідація на ВСІХ ендпоінтах (body, query, params)
- **Prisma** — всі DB запити через Prisma. Raw SQL тільки для PostGIS (`ST_DWithin`, `ST_MakePoint`)
- **DTO + Class-validator** — для NestJS pipes
- **Fire-and-forget** — Telegram і FCM ніколи не блокують відповідь. Завжди `void` без `await` або через `setImmediate`
- **Bull** — всі retry-черги через Bull, не in-memory
- **Idempotency** — `INSERT ... ON CONFLICT (external_id, establishment_id) DO NOTHING` для POS замовлень
- Жодних `console.log` — тільки NestJS `Logger`

---

## Multi-tenant — обовʼязкові правила

Кожен Prisma запит на дані тенанта **обовʼязково** містить `where: { establishment_id }`:

```typescript
// ✅ Правильно
const orders = await prisma.order.findMany({
  where: { establishment_id: req.user.establishment_id, status: 'pending' }
});

// ❌ НЕБЕЗПЕЧНО — витік між тенантами
const orders = await prisma.order.findMany({ where: { status: 'pending' } });
```

---

## PlanAccessGuard

Застосовується через `@UseGuards(JwtAuthGuard, PlanAccessGuard)` на всіх бізнес-ендпоінтах.

**НЕ застосовується на:** `/health`, `/api/v1/auth/*`, `/api/v1/onboarding/accept-invite/:token`

Логіка:
```typescript
if (est.plan === 'pilot') return true;
if (est.paid_until > NOW()) return true;
if (est.trial_ends_at > NOW()) return true;
if (est.trial_ends_at + 7 days > NOW()) return true;
throw HttpException({ code: 'PLAN_EXPIRED' }, 402);
```

---

## WebSocket Auth

Клієнт: `io(WS_URL, { auth: { token: accessToken } })`
Сервер: `handleConnection()` перевіряє JWT → `socket.join('est:' + establishment_id)`
Неавторизовані — відхиляються негайно. Менеджер отримує тільки події свого закладу.

---

## Notifications — правила

```typescript
// ✅ Правильно (fire-and-forget)
this.notificationsService.sendPush(courierId, payload).catch(err =>
  this.logger.warn('FCM failed', err)
);

// ❌ Неправильно — блокує відповідь курʼєру
await this.notificationsService.sendTelegram(managerId, message);
```

FCM push при `invalid_registration` → автоматично видалити `device_token` з `couriers`.

---

## Курʼєрський додаток — GPS

- **Foreground service** (Android) + **background location** (iOS) — GPS працює у фоні без участі курʼєра
- Пінг кожні **15 секунд** під час активної доставки
- При старті доставки → показувати **persistent notification** у шторці (незакривне)
- Onboarding: запитувати `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` для Xiaomi/Samsung/Huawei

---

## Дашборд менеджера — статус курʼєрів

| Стан | Умова | UI |
|------|-------|-----|
| 🟢 Онлайн | пінг < 30 сек | Зелена крапка |
| 🟡 Фон | пінг 30 сек – 5 хв | Жовта + "X хв тому" |
| 🔴 Не відповідає | пінг > 5 хв під час активної доставки | Червона + кнопка [Нагадати] |
| ⚫ Офлайн | немає активної доставки + пінг > 5 хв | Сіра крапка |

---

## Тести — мінімальний стандарт

**P0 (блокують мерж):**
- State machine: всі валідні і невалідні переходи
- Multi-tenant: дані закладу A недоступні для закладу B
- Geo-proof: 300м перевірка (`geo_match` true/false), доставка не блокується при `geo_match=false`
- Retention: `delivery_proofs` ніколи не видаляються
- WS auth: невалідний JWT → відхилення
- iiko 429 → exponential backoff, не падає

**P1:**
- Всі API ендпоінти (Supertest): авторизація, валідація, HTTP статуси
- Дублікат POS замовлення → один запис у БД
- Poster HMAC: невалідний підпис → 401

---

## Порядок реалізації (дотримуватись)

```
1.  Prisma schema + migrations (всі таблиці одразу)
2.  AuthModule (JWT + refresh tokens)
3.  EstablishmentsModule + PlanAccessGuard
4.  CouriersModule
5.  OrdersModule (state machine)
6.  TrackingModule (GPS пінги + Redis + WebSocket)
7.  ProofOfDeliveryModule
8.  NotificationsModule (FCM + Telegram)
9.  RetentionModule (cron jobs)
10. IntegrationsModule (Poster → iiko)
11. OnboardingModule
12. AnalyticsModule
13. Manager Dashboard (Next.js) — після готового API
14. Courier App (React Native) — після Dashboard
```

---

## Що НЕ чіпати без обговорення

- `database/migrations/` — тільки через `prisma migrate dev`
- State machine transitions в `OrdersModule` та `ProofOfDeliveryModule`
- `PlanAccessGuard` логіка — зміна може зламати білінг
- `delivery_proofs` retention — ця таблиця захищена навмисно
- WebSocket room naming: `est:{establishment_id}` — зміна зламає multi-tenant ізоляцію

---

## Environment Variables (обовʼязкові)

```
DATABASE_URL         postgresql://...?connection_limit=20&pool_timeout=10
REDIS_URL            redis://...
JWT_ACCESS_SECRET    (rotate 90 days)
JWT_REFRESH_SECRET   (rotate 180 days)
FIREBASE_SERVICE_ACCOUNT_JSON
TELEGRAM_BOT_TOKEN
S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY / S3_BUCKET
BACKUP_S3_ACCESS_KEY / BACKUP_S3_SECRET_KEY
WEBHOOK_HMAC_SECRET  (per-establishment, stored in DB)
```

Ніяких `.env` файлів у репозиторії. `.gitignore` + pre-commit hook.

---

## Формат одного сеансу роботи

Один сеанс = один модуль. Починати з:
1. Назва модуля і що він робить
2. Релевантна частина Prisma schema (не вся)
3. Список ендпоінтів або функцій
4. Тести — писати разом з кодом, не після

Після завершення модуля: `git commit` → новий контекст.
