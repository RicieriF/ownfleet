---
title: "@weego CMI — Technical Architecture Document"
version: "1.2"
status: Draft
pattern: "Modular Monolith → Microservices"
updated: "2026-03-21"
changes_v1_2: >
  Eng Review: connection pooling, idempotency, DB indexes, ping retention,
  testing strategy, Telegram as side-channel, performance fixes.
  v1.2.1: State machines, deliveries status field, OnboardingModule,
  push token lifecycle, API versioning.
---

# @weego CMI
## Technical Architecture Document v1.2

---

## 📋 Метадані

| Поле | Значення |
|------|----------|
| Тип документа | Technical Architecture Document |
| Версія | 1.2 |
| Статус | Draft |
| Патерн | Modular Monolith → Microservices |
| Зміни v1.2 | Eng Review: connection pooling, idempotency, DB indexes, ping retention, testing strategy, Telegram as side-channel, performance fixes |

---

## 1. 🏗️ Огляд архітектури

@weego CMI побудований за патерном **Modular Monolith** — єдиний розгорнутий застосунок з чітко розділеними модулями. Оптимальний вибір для MVP: простота розгортання + чіткі межі для майбутнього виділення сервісів.

### Рівні системи

| Рівень | Технологія | Опис |
|--------|------------|------|
| Mobile (Кур'єр) | React Native + Expo | iOS/Android додаток для кур'єрів |
| Web (Менеджер) | Next.js 14 | Дашборд управління кур'єрами та замовленнями |
| API (Backend) | NestJS (TypeScript) | REST API + WebSocket Gateway |
| Realtime Bus | Redis Pub/Sub | Fan-out live позицій на WS підключення |
| Primary DB | PostgreSQL + PostGIS | Основна БД з геопросторовими запитами |
| File Storage | Cloudflare R2 | Фото доставок — опціональні (S3-сумісний) |
| Cache | Redis | Live позиції кур'єрів (TTL 5 хв) |
| Infrastructure | Railway.app | PaaS хостинг для MVP |

---

## 2. 🛠️ Tech Stack

### Backend

| Компонент | Технологія | Обгрунтування |
|-----------|------------|---------------|
| Framework | NestJS (TypeScript) | Модульна структура, вбудований WebSocket, DI, TypeScript |
| Database | PostgreSQL 15 + PostGIS | ACID, геозапити (маршрути, зони, радіус), надійність |
| Cache / Pub-Sub / Queue | Redis 7 | Sub-ms латентність, pub/sub для WS fan-out, Bull job queue для webhook retries |
| ORM | Prisma | TypeScript-first, міграції. `?connection_limit=20&pool_timeout=10` в `DATABASE_URL` — запобігає вичерпанню з'єднань PostgreSQL *(fixed)* |
| Auth | JWT + Refresh Tokens | Stateless, multi-tenant через claims |
| File Upload | Cloudflare R2 (presigned) | Нульовий egress cost, S3-сумісний |
| Notifications | Telegram Bot + Firebase FCM | Side-channel, **fire-and-forget** — не блокує основний флоу, відправляється асинхронно *(updated)* |

### Frontend / Mobile

| Компонент | Технологія | Обгрунтування |
|-----------|------------|---------------|
| Mobile App | React Native + Expo SDK 51 | iOS + Android з одного коду, OTA updates (EAS) |
| Background GPS | expo-location + BackgroundFetch | Трекінг при згорнутому додатку |
| Offline Support | expo-sqlite + queue | Зберігає пруфи без інтернету |
| Manager Dashboard | Next.js 14 (App Router) | SSR + React real-time, TypeScript |
| Maps | Leaflet + OpenStreetMap | Безкоштовно, без API ключа, гнучко |
| UI Kit | shadcn/ui + Tailwind CSS | Готові компоненти, швидка розробка |
| Real-time (WS) | Socket.io-client | Auto-fallback, надійне з'єднання |

---

## 3. 🧩 Модулі NestJS API

API побудований як Modular Monolith з чіткими межами між модулями. Кожен модуль відповідає за окремий **bounded context** системи.

> **API Versioning:** All endpoints use `/api/v1/` prefix. Version is also available via header `Accept-Version: 1`. Breaking changes increment the major version. Non-breaking additions are backward compatible within v1.

> **WebSocket Authentication:** The manager dashboard connects via Socket.io with `auth: { token: accessToken }` in the handshake. `TrackingGateway.handleConnection()` verifies the JWT and joins the client to room `est:{establishment_id}`. Unauthenticated connections are immediately disconnected. This ensures multi-tenant isolation at the WS layer — managers only receive `courier_moved` events for their own establishment.

| Модуль | Відповідальність | Ключові ендпоінти | |
|--------|-----------------|------------------|-|
| `AuthModule` | JWT аутентифікація, refresh tokens, tenant isolation | `POST /api/v1/auth/login`<br>`/api/v1/auth/refresh`<br>`/api/v1/auth/logout` | |
| `EstablishmentsModule` | Multi-tenant управління закладами | `CRUD /api/v1/establishments`<br>`GET\|PATCH /api/v1/establishments/:id/settings` | |
| `CouriersModule` | Управління кур'єрами закладу | `CRUD /api/v1/couriers`<br>`/api/v1/couriers/:id/assign`<br>`POST /api/v1/couriers/:id/device-token` | |
| `OrdersModule` | Замовлення, статусна машина, призначення. `UNIQUE(external_id, establishment_id)` — захист від дублікатів POS | `CRUD /api/v1/orders`<br>`POST /api/v1/orders/:id/assign`<br>`PATCH /api/v1/orders/:id/cancel` | **FIXED** |
| `TrackingModule` (WS Gateway) | Прийом GPS пінгів, Redis pub/sub, WebSocket до дашборду | `POST /api/v1/tracking/ping`<br>`WS: courier_moved` | |
| `ProofOfDeliveryModule` | Гео-пруф (обов'язковий) + фото (опціональний), радіус 300м, два timestamps | `GET /api/v1/deliveries/:id/upload-url`<br>`POST /api/v1/deliveries/:id/complete`<br>`PATCH /api/v1/deliveries/:id/start`<br>`PATCH /api/v1/deliveries/:id/fail` | **UPDATED** |
| `RetentionModule` | Cron очищення замовлень та GPS-пінгів. Окреме `retention_pings_days` (1–3 дні) | `Internal: @Cron("0 3 * * *")`<br>`GET\|PATCH /api/v1/establishments/:id/settings` | **NEW** |
| `IntegrationsModule` | Адаптери Poster POS та iiko/Syrve | `POST /api/v1/integrations/poster/webhook`<br>`GET /api/v1/integrations/iiko/orders` | |
| `WebhooksModule` | Outbound webhook dispatcher з HMAC | `CRUD /api/v1/webhooks`<br>`Internal: dispatch events` | |
| `NotificationsModule` | Telegram Bot + Firebase FCM. **Fire-and-forget**, ніколи не блокує API. Управляє lifecycle push-токенів: реєстрація, оновлення при ротації, очищення stale токенів після помилки `invalid_registration` | `Internal: send() async`<br>`POST /api/v1/couriers/:id/device-token` | **UPDATED** |
| `OnboardingModule` | Управляє процесом реєстрації закладу, invite-токенами кур'єрів, прогресом onboarding-стану | `POST /api/v1/onboarding/invite-courier`<br>`GET /api/v1/onboarding/status`<br>`POST /api/v1/onboarding/accept-invite/:token` | **NEW** |
| `AnalyticsModule` | Статистика доставок, ефективність кур'єрів | `GET /api/v1/analytics/summary`<br>`GET /api/v1/analytics/couriers` | |

---

## 4. 📡 Real-time Tracking Flow

Жива карта на дашборді менеджера оновлюється через WebSocket. Redis Pub/Sub забезпечує fan-out на всі підключені клієнти одного закладу.

```
Кур'єр (фон)  →  POST /api/v1/tracking/ping  →  TrackingModule
                                                       │
                                             Redis SET courier:{id}:pos (TTL 5хв)
                                             PostgreSQL INSERT location_pings
                                             Redis PUBLISH channel:est:{id}:tracking
                                                       │
                                             WebSocket Gateway (SUBSCRIBE)
                                                       │
                                             Emit "courier_moved"
                                                       │
                                             Manager Dashboard → leafletMarker.setLatLng()
```

| # | Дія | Деталь |
|---|-----|--------|
| 1 | Кур'єрський додаток (фон) | `POST /api/v1/tracking/ping { lat, lng, accuracy, battery }` — кожні 15 секунд |
| 2 | TrackingModule обробляє пінг | `Redis SET courier:{id}:pos TTL=5хв`<br>`PostgreSQL INSERT location_pings (PostGIS POINT)`<br>`Redis PUBLISH channel:est:{id}:tracking` |
| 3 | WebSocket Gateway | `SUBSCRIBE` Redis channel → `Emit "courier_moved"` до всіх WS-клієнтів закладу |
| 4 | Manager Dashboard | `Socket.io listener → leafletMarker.setLatLng()`<br>Якщо пінг не надходив > 2 хв → маркер сірий + "остання активність X хв тому" |

---

## 5. ✅ Proof of Delivery Flow

> **UPDATED — Гео-пруф як основний доказ доставки**
>
> В Україні кур'єри передають замовлення напряму в руки — на відміну від США. Тому GPS-координати = **обов'язковий** доказ, фото = **опціональне**. Фіксуються два timestamps: `order_closed_at` і `proof_captured_at`.
>
> **FIXED** — Telegram/SMS надсилаються **асинхронно** (fire-and-forget) і не блокують відповідь кур'єру.

| # | Дія | Статус |
|---|-----|--------|
| 1 | Кур'єр натискає "Доставлено" в додатку | |
| 2 | Пристрій фіксує GPS (ОБОВ'ЯЗКОВО) — `lat, lng, accuracy, captured_at` | **FIXED** |
| 3 | Відкривається камера для фото (ОПЦІОНАЛЬНО). Якщо є — стискається до ~150 KB | |
| 4 | Якщо є фото: `GET /api/v1/deliveries/{id}/upload-url` → Presigned R2 URL (TTL 5 хв) → `PUT` фото напряму в R2 | |
| 5 | `POST /api/v1/deliveries/{id}/complete { lat, lng, captured_at, photo_key? }` | |
| 6 | Backend: `PostGIS ST_DWithin` — перевірка GPS в радіусі 300м → `geo_match = true/false` | |
| 7 | `INSERT delivery_proofs` · `UPDATE deliveries SET status='completed', order_closed_at=NOW()` | |
| 8 | **[async]** Telegram менеджеру: "Доставлено. Гео: [посилання]" + фото якщо є | **FIXED** |
| 9 | **[async]** Telegram/SMS клієнту: "Ваше замовлення доставлено!" | **FIXED** |

---

## 5b. 🗑️ Data Retention Flow

> **NEW — Автоматичне очищення старих даних**
>
> - `retention_days` — скільки днів зберігати замовлення (1 / 3 / 5 / 7 / 14 / 30)
> - `retention_pings_days` — окреме налаштування для GPS-пінгів (рекомендовано **1–3 дні**)
> - `delivery_proofs` **ніколи не видаляються** (зберігаються для вирішення спорів)

| # | Дія | |
|---|-----|-|
| 1 | `@Cron("0 3 * * *")` — щоночі о 03:00 | **NEW** |
| 2 | `SELECT id, settings->>'retention_days', settings->>'retention_pings_days' FROM establishments` | |
| 3 | `DELETE orders WHERE establishment_id=X AND created_at < NOW() - INTERVAL N days` | |
| 4 | `DELETE location_pings WHERE created_at < NOW() - INTERVAL P days` (P = `retention_pings_days`, рекомендовано 1–3). **Batch by 1000 rows** to avoid table lock: `DELETE FROM location_pings WHERE id IN (SELECT id FROM location_pings WHERE created_at < cutoff LIMIT 1000)` | |
| 5 | `delivery_proofs` НЕ видаляються (зберігаються назавжди) | |
| 6 | `INSERT retention_logs (establishment_id, deleted_orders, deleted_pings, run_at)`. При падінні job — alert через `NotificationsModule` | **NEW** |

---

## 6. 🔌 Інтеграції

### Poster POS

Poster надає REST API та webhook систему. При новому замовленні надсилає webhook до нашого ендпоінту.

| Крок | Опис |
|------|------|
| Вхідний webhook | `POST /api/v1/integrations/poster/webhook` |
| Валідація | Перевірка HMAC підпису → парсинг замовлення |
| Маппінг | Poster Order → внутрішній Order entity. Збереження `external_id` для зворотного зв'язку |
| Idempotency | `INSERT ... ON CONFLICT (external_id, establishment_id) DO NOTHING` — захист від дублікатів |
| Призначення | Сповіщення доступним кур'єрам (Push + Telegram async) |
| Оновлення статусу | При зміні статусу доставки → `PATCH Poster API /orders/{id}` |

### iiko / Syrve (SOI API)

| Режим | Опис |
|-------|------|
| Pull (polling) | `GET iiko SOI API` кожні 30 сек **(±10 сек jitter)** → нові замовлення → create internal order. **Note:** з 2+ API instances — кожен instance поллить незалежно. `ON CONFLICT DO NOTHING` захищає від дублікатів, але викликає N×API calls. V2: Redis lock або виділений polling worker. |
| Webhook | iiko надсилає events при зміні статусу → обробка аналогічно до Poster |
| Idempotency | `INSERT ... ON CONFLICT (external_id, establishment_id) DO NOTHING` — захист від дублікатів polling + webhook |
| Зворотній зв'язок | `POST iiko SOI /orders/{id}/status` при завершенні доставки |

### Generic Outbound Webhooks

Для закладів без підтримуваного POS або для кастомних інтеграцій — система відправляє події на налаштований URL з HMAC-підписом.

| Параметр | Значення |
|----------|----------|
| Events | `delivery.assigned` \| `delivery.started` \| `delivery.completed` \| `delivery.failed` |
| Headers | `X-Signature: hmac-sha256(payload, secret)` \| `X-Timestamp: unix_ts` |
| Retry | Exponential backoff: `1s → 5s → 30s → 5хв → 30хв`. Max 5 спроб. При невдачі — alert менеджеру та `webhooks.last_error` оновлюється. **Реалізація через Bull (@nestjs/bull) з Redis** — retry-черга персистентна, виживає при API restart. Redis вже є в стеку, тому додаткової інфраструктури не потрібно. |

---

## 7. 🗄️ Схема бази даних

Multi-tenancy через `establishment_id` на кожній таблиці. JWT payload містить `establishment_id` claim, middleware перевіряє ізоляцію тенанта.

### `establishments` *(updated)*
```sql
id                 UUID PRIMARY KEY
name               TEXT
plan               TEXT  CHECK (plan IN ('pilot','trial','starter','business','pro'))
trial_ends_at      TIMESTAMP  -- NULL for pilot; set to registration_date + 14 days for trial
paid_until         TIMESTAMP  -- NULL until first payment; updated on each payment
created_at         TIMESTAMP
onboarding_status  TEXT CHECK (onboarding_status IN ('registered','couriers_added','first_delivery','completed'))
settings           JSONB  -- { retention_days: 1|3|5|7|14|30,
                          --   retention_pings_days: 1-3 }
```

**Plan states:**

| Plan | Access | Duration | Notes |
|------|--------|----------|-------|
| `pilot` | Full (unlimited) | Indefinite | First 3-5 zakl for validation |
| `trial` | Full | 14 days | Auto-creates on registration |
| `starter` | Starter features | Monthly (paid) | Up to 5 couriers |
| `business` | Business features | Monthly (paid) | Up to 20 couriers + POS |
| `pro` | All features | Monthly (paid) | Unlimited + API |

**Access control (MVP):** after `trial_ends_at + 7 days grace` with no `paid_until` → dashboard returns HTTP 402, courier app stops accepting new orders after further 7 days.

**Implementation:** `PlanAccessGuard` (NestJS Guard) applied via `@UseGuards(JwtAuthGuard, PlanAccessGuard)` at controller level. Guard reads `establishment.plan`, `trial_ends_at`, `paid_until` from DB and throws `HttpException(402)` when access should be blocked. Applied to all business endpoints; NOT applied to `/health`, `/auth/*`, `/onboarding/accept-invite/*` (public courier invite link).

```typescript
// Guard logic
if (est.plan === 'pilot') return true;  // always allowed
if (est.paid_until > NOW()) return true;  // active subscription
if (est.trial_ends_at > NOW()) return true;  // within trial period
if (est.trial_ends_at + 7 days > NOW()) return true;  // within grace period
throw new HttpException({ code: 'PLAN_EXPIRED', message: 'Trial expired' }, 402);
```

### `users`
```sql
id                UUID PRIMARY KEY
establishment_id  UUID REFERENCES establishments
role              TEXT  CHECK (role IN ('owner','manager','dispatcher'))
email             TEXT
password_hash     TEXT
```

**Permissions table:**

| Role | Courier management | Order management | Analytics | Billing settings | User management |
|------|--------------------|-----------------|-----------|-----------------|----------------|
| `owner` | ✅ Full | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| `manager` | ✅ Full | ✅ Full | ✅ Read | ❌ | ❌ |
| `dispatcher` | ✅ Assign only | ✅ Assign/status | ❌ | ❌ | ❌ |

> **Owner** — власник закладу. Єдиний хто може змінювати тарифний план, переглядати billing, додавати/видаляти менеджерів.
> **Manager** — операційний менеджер. Управляє кур'єрами і замовленнями.
> **Dispatcher** — диспетчер. Тільки призначення замовлень кур'єрам.

### `couriers`
```sql
id                UUID PRIMARY KEY
establishment_id  UUID REFERENCES establishments
name              TEXT
phone             TEXT
device_token      TEXT  -- для FCM push
device_platform   TEXT  -- 'ios' | 'android'
active            BOOLEAN

INDEX (establishment_id)               -- для multi-tenant запитів
INDEX (establishment_id, active)       -- для запитів активних кур'єрів закладу
```

### `orders` *(fixed)*
```sql
id                UUID PRIMARY KEY
establishment_id  UUID REFERENCES establishments
external_id       TEXT  -- ID із зовнішньої POS-системи
address           TEXT
lat               DECIMAL
lng               DECIMAL
status            TEXT CHECK (status IN ('pending','assigned','in_progress','completed','cancelled','failed'))
source            TEXT  -- poster | iiko | manual
created_at        TIMESTAMP

UNIQUE (external_id, establishment_id)        -- захист від дублікатів POS
INDEX  (establishment_id, status)             -- новий
INDEX  (establishment_id, created_at)         -- новий
```

### `deliveries` *(updated)*
```sql
id                     UUID PRIMARY KEY
order_id               UUID REFERENCES orders
courier_id             UUID REFERENCES couriers
status                 TEXT CHECK (status IN ('assigned','in_progress','completed','failed'))
assigned_at            TIMESTAMP
assignment_timeout_at  TIMESTAMP  -- assigned_at + 3 min; system auto-unassigns if courier doesn't start
started_at             TIMESTAMP
completed_at           TIMESTAMP
order_closed_at        TIMESTAMP
proof_id               UUID

INDEX (courier_id, status)                    -- новий
INDEX (assignment_timeout_at) WHERE status='assigned'  -- для efficient timeout polling
```

### `delivery_proofs` *(updated)*
```sql
id                UUID PRIMARY KEY
delivery_id       UUID REFERENCES deliveries
lat               DECIMAL    -- ОБОВ'ЯЗКОВИЙ
lng               DECIMAL    -- ОБОВ'ЯЗКОВИЙ
captured_at       TIMESTAMP
order_closed_at   TIMESTAMP
photo_key         TEXT       -- ОПЦІОНАЛЬНИЙ (Cloudflare R2 key)
geo_match         BOOLEAN    -- результат ST_DWithin перевірки
accuracy          DECIMAL    -- точність GPS у метрах з пристрою
geo_flags         JSONB      -- { low_accuracy: bool, impossible_speed: bool, mock_suspected: bool }

-- Ніколи не видаляється (retention не застосовується)
```

### `location_pings`
```sql
id          UUID PRIMARY KEY
courier_id  UUID REFERENCES couriers
location    GEOMETRY(Point, 4326)  -- PostGIS
battery     INT
created_at  TIMESTAMP

INDEX GIST (location)
INDEX (created_at)                     -- для retention cron DELETE WHERE created_at < NOW() - INTERVAL
INDEX (courier_id, created_at DESC)    -- для запиту останньої позиції кур'єра
-- Очищається за retention_pings_days (1–3 дні)
```

### `integrations`
```sql
id                UUID PRIMARY KEY
establishment_id  UUID REFERENCES establishments
type              TEXT  -- poster | iiko | webhook
config            JSONB
active            BOOLEAN
```

### `webhooks`
```sql
id                   UUID PRIMARY KEY
establishment_id     UUID REFERENCES establishments
url                  TEXT
secret               TEXT
events               TEXT[]
active               BOOLEAN     -- set to false after consecutive_failures >= 5
consecutive_failures INT DEFAULT 0  -- reset to 0 on success
last_error           TEXT
last_error_at        TIMESTAMP
```

> **Auto-disable logic:** After `consecutive_failures >= 5` → set `active=false` → alert manager with re-enable button. On next successful delivery event → reset counter to 0. Prevents indefinite hammering of a broken endpoint.

### `retention_logs` *(new)*
```sql
id                UUID PRIMARY KEY
establishment_id  UUID REFERENCES establishments
deleted_orders    INT
deleted_pings     INT
run_at            TIMESTAMP
-- Audit trail кожного cleanup-запуску
```

### `invite_tokens` *(new)*
```sql
id                UUID PRIMARY KEY
establishment_id  UUID REFERENCES establishments
token             TEXT UNIQUE  -- short alphanumeric, used in deep link
courier_id        UUID REFERENCES couriers  -- NULL until accepted
expires_at        TIMESTAMP  -- typically +48h
used_at           TIMESTAMP  -- NULL = not yet used
created_at        TIMESTAMP
```

---

### Courier Order Assignment Flow

**Timeout enforcement:** `RetentionModule` (або окремий `AssignmentModule`) має `@Cron("* * * * *")` — щохвилини перевіряє `deliveries WHERE status='assigned' AND assignment_timeout_at < NOW()` і автоматично скасовує призначення. Індекс `INDEX (assignment_timeout_at) WHERE status='assigned'` забезпечує ефективний запит.

```
Manager assigns order
       │
       ▼
POST /api/v1/orders/:id/assign { courier_id }
       │
       ├── UPDATE orders SET status='assigned'
       ├── INSERT deliveries (status='assigned')
       └── [async] Firebase FCM push to courier
                     │
              ┌──────┴──────┐
              │             │
         Courier sees    No response
         notification    within 3 min
              │             │
         PATCH /deliveries  │
         /:id/start         │
         (confirms pickup)  │
              │        [System auto-unassigns]
              ▼             ▼
         delivery:     order → 'pending'
         in_progress   delivery → 'failed'
                       [async] notify manager
                       Manager can re-assign
```

| # | Сценарій | Поведінка |
|---|----------|-----------|
| 1 | Кур'єр натискає "Прийняти" → `PATCH /api/v1/deliveries/:id/start` | order → `in_progress`, delivery → `in_progress` |
| 2 | Кур'єр не реагує 3 хвилини (timeout) | Система скасовує призначення → order → `pending`, менеджер отримує alert |
| 3 | Кур'єр недоступний (app закритий) | Push не доставлено → fallback: менеджер отримує alert "кур'єр не підтвердив" через 3 хв |
| 4 | Менеджер перепризначає замовлення | `PATCH /api/v1/orders/:id/assign` з новим `courier_id` (тільки для `pending` або failed-assignment) |

> **Важливо:** Кур'єр НЕ може явно "відхилити" замовлення — тільки ігнорувати (timeout). Це спрощує UX і уникає конфліктів. Менеджер бачить відсутність підтвердження на дашборді.

**Нове поле в `deliveries`:**
```sql
assignment_timeout_at  TIMESTAMP  -- коли спрацьовує auto-unassign (assigned_at + 3 min)
```

---

### Onboarding Flow

```
1. Manager registers establishment → POST /api/v1/auth/register
2. Manager adds first courier → POST /api/v1/couriers
3. Manager generates invite → POST /api/v1/onboarding/invite-courier → returns deep link
4. Deep link sent via SMS/Telegram to courier
5. Courier opens link → installs app → POST /api/v1/onboarding/accept-invite/:token
6. Courier is linked to establishment, device_token registered
7. Manager creates first test order → POST /api/v1/orders
8. Courier accepts and delivers → POST /api/v1/deliveries/:id/complete
9. onboarding_status → 'completed'
```

---

### Push Token Lifecycle

```
App start → POST /api/v1/couriers/:id/device-token { token, platform: 'ios'|'android' }
         → UPDATE couriers SET device_token = token, device_platform = platform

FCM send fails with 'invalid_registration' or 'NotRegistered'
         → DELETE couriers.device_token (stale token cleanup)
         → Next time courier opens app, token re-registered

Token refresh (Firebase rotates tokens periodically)
         → App detects new token via onTokenRefresh callback
         → POST /api/v1/couriers/:id/device-token with new token
```

---

## 8. 📐 Architecture Decision Records (ADR)

### ADR-001: Modular Monolith замість Microservices

| | |
|-|-|
| **Рішення** | Єдиний NestJS застосунок з ізольованими модулями. |
| **Обгрунтування** | Мала команда (1–3 розробники), MVP стадія. Складність Kubernetes + service mesh зменшила б швидкість без реальної потреби. |
| **Trade-off** | Обмежена незалежна масштабованість. Мітигація: NestJS модулі — готові межі для виділення сервісів. |

### ADR-002: Redis Pub/Sub замість Kafka

| | |
|-|-|
| **Рішення** | Redis для pub/sub real-time трекінгу. |
| **Обгрунтування** | При MVP масштабі (100–1000 кур'єрів) Redis достатньо. Вже є в стеку для кешу. |
| **Trade-off** | При втраті Redis live-позиції губляться (немає persistence). Прийнятно — критичні дані в PostgreSQL. |

### ADR-003: React Native + Expo замість Native

| | |
|-|-|
| **Рішення** | Один codebase для iOS та Android. |
| **Обгрунтування** | Економія ~50% часу розробки. EAS Update — OTA оновлення без перепублікації. |
| **Trade-off** | Трохи вища споживаність батареї для фонового GPS. Вирішується оптимізацією інтервалів пінгів. |

### ADR-004: Cloudflare R2 замість AWS S3

| | |
|-|-|
| **Рішення** | Cloudflare R2 для зберігання фото доставок. |
| **Обгрунтування** | Нульовий egress cost. S3-сумісний API. Перші 10 GB/міс безкоштовно. |
| **Trade-off** | Менша екосистема AWS. Несуттєво для даного use case. |

### ADR-005: Гео-пруф як основний Proof of Delivery *(new)*

| | |
|-|-|
| **Рішення** | GPS-координати — обов'язковий доказ. Фото — опціональне. |
| **Обгрунтування** | В Україні кур'єри передають замовлення в руки клієнту (не залишають під дверима). Два timestamps (`order_closed_at`, `proof_captured_at`) виявляють маніпуляції. |
| **Trade-off** | Заклади, звиклі до фото, потребують onboarding. Мітигація: фото залишається опцією. |

### ADR-006: Per-establishment Data Retention *(new)*

| | |
|-|-|
| **Рішення** | Два окремих налаштування: `retention_days` (замовлення) і `retention_pings_days` (GPS-пінги, 1–3 дні). |
| **Обгрунтування** | Пінги ростуть найшвидше (15-сек інтервал) — 100 кур'єрів = ~24K рядків/день. Короткий retention пінгів критичний для розміру БД. |
| **Trade-off** | Якщо не встановлено — нічого не видаляється (безпечний default). |

### ADR-007: Prisma `connection_limit` замість PgBouncer *(new)*

| | |
|-|-|
| **Рішення** | `?connection_limit=20&pool_timeout=10` в `DATABASE_URL`. |
| **Обгрунтування** | Managed PostgreSQL зазвичай обмежує ~100 з'єднань на план. Без обмеження Prisma може вичерпати їх при 100+ активних кур'єрах. Один рядок без нової інфраструктури. |
| **Trade-off** | При 5+ API instances → Prisma Accelerate або PgBouncer. На MVP достатньо. |

### ADR-008: Telegram як side-channel (fire-and-forget) *(new)*

| | |
|-|-|
| **Рішення** | Telegram — допоміжний канал. Ніколи не в критичному шляху запиту. |
| **Обгрунтування** | Telegram може бути повільним або недоступним. Блокування proof of delivery через зовнішній сервіс неприйнятне для UX кур'єра. |
| **Trade-off** | Менеджер може не отримати сповіщення якщо Telegram недоступний. Мітигація: дашборд — основне джерело правди, Telegram — зручність. |

---

## 9. ☁️ Infrastructure та розгортання

> **⚠️ Vendor-agnostic принцип:** Конкретний хостинг-провайдер (Railway, Fly.io, Render, GCP Cloud Run, AWS ECS) — **операційне рішення**, не архітектурне. Воно приймається окремо на основі ціни, регіону та досвіду команди. Нижче — вимоги до інфраструктури. Приклади провайдерів наведені як референс, не як тверде зобов'язання.

### Вимоги до інфраструктури (MVP)

| Компонент | Що потрібно | Приклади провайдерів | Оціночна вартість/міс |
|-----------|-------------|---------------------|----------------------|
| NestJS API | PaaS хостинг, 1 instance, Node 20 | Railway, Fly.io, Render, GCP Cloud Run | ~$5–15 |
| PostgreSQL + PostGIS | Managed PostgreSQL 15 з PostGIS розширенням | Railway, Supabase, Neon, AWS RDS | ~$5–20 |
| Redis | Managed Redis 7 | Railway, Upstash, Redis Cloud | ~$3–10 |
| File Storage | S3-сумісний object storage (presigned URLs) | Cloudflare R2, AWS S3, Backblaze B2 | $0–5 |
| Mobile builds | Managed React Native / Expo builds | Expo EAS Build (free tier) | $0 |
| Push Notifications | Firebase FCM | Firebase (free tier) | $0 |
| **РАЗОМ** | | | **~$13–50/міс** |

### Вимоги до платформи (чеклист для вибору провайдера)

- [ ] PostgreSQL 15+ з підтримкою PostGIS розширення
- [ ] Managed Redis 7+
- [ ] S3-сумісний API для file storage
- [ ] Автоматичні щоденні backups PostgreSQL (мінімум 7 днів retention)
- [ ] Підтримка environment variables / secrets management
- [ ] Health check endpoint support (для auto-restart unhealthy instances)
- [ ] GitHub Actions або аналогічна CI/CD інтеграція
- [ ] Мінімум 512 MB RAM для NestJS instance

### Scaling (при зростанні)

100+ закладів / 1000+ одночасних кур'єрів → горизонтальне масштабування API (2–5 instances) + Redis Cluster + PostgreSQL read replicas. При 5+ instances → **Prisma Accelerate** або **PgBouncer** для connection pooling. Архітектура (NestJS Modular Monolith, Prisma ORM, Redis pub/sub) — незалежна від хостинг-провайдера.

---

## 10. 🔒 Security

| Механізм | Опис | |
|----------|------|-|
| TLS 1.3 | Весь трафік зашифрований, HTTP → HTTPS redirect | |
| JWT + Refresh Tokens | Access token TTL 15 хв, Refresh TTL 30 днів, HttpOnly cookie | |
| WebSocket auth | JWT передається у `socket.auth.token` при handshake. `handleConnection()` перевіряє токен через JwtService → витягує `establishment_id` → клієнт приєднується до room `est:{id}`. З'єднання без валідного токена відхиляються негайно. | **NEW** |
| Multi-tenant isolation | REST: `establishment_id` в кожному запиті, middleware-перевірка. WS: кожен клієнт ізольований у власній кімнаті `est:{id}`, отримує тільки свої події. | **UPDATED** |
| Rate Limiting | 100 req/хв per user, 10 req/сек per IP на `/api/v1/tracking/ping` | |
| HMAC webhooks | Підпис вхідних (Poster) та вихідних webhook запитів | |
| Presigned URLs | Фото завантажуються напряму в R2, без проходу через API | |
| Input Validation | Zod схеми на всіх ендпоінтах, SQL injection захист через Prisma | |
| Idempotency keys | `UNIQUE(external_id, establishment_id)` на `orders` — захист від дублікатів при race condition | **FIXED** |
| Retention audit | `retention_logs` — audit trail кожного очищення даних | **NEW** |
| GPS accuracy validation | Якщо `accuracy > 100м` → `low_accuracy` флаг в `delivery_proofs`. Не блокує доставку, але видно менеджеру. | **NEW** |
| GPS speed validation | Швидкість між останнім пінгом і пруфом > 120 км/год → `impossible_speed` флаг. Фізично неможливо. | **NEW** |
| Mock location detection | Android `isFromMockProvider()` → `mock_suspected` флаг. Secondary signal only — обходиться на Android 6+, недоступний на iOS. | **NEW** |
| Secret management | Всі секрети в Railway Environment Variables, ніколи в `.env` в репозиторії. `.gitignore` + pre-commit hook. | **NEW** |

### Anti-spoofing Strategy

Three-layer approach:

| Layer | Method | Reliability | Platform |
|-------|--------|-------------|----------|
| Accuracy check | `accuracy > 100m` → flag | High | iOS + Android |
| Speed check | `> 120 km/h` between last ping and proof | High | iOS + Android |
| Mock flag | `isFromMockProvider()` | Low (bypassable) | Android only |
| Operational | Manager sees full GPS track on map | High | All |

> ⚠️ **Important:** Perfect GPS spoofing prevention is impossible at app layer. The main deterrent is operational — managers see the full GPS track for every delivery, and inconsistent tracks are immediately visible. The timestamp pair (`order_closed_at` vs `proof_captured_at`) catches after-the-fact manipulation.

### Secret Management

All secrets stored in **hosting platform's Environment Variables** — never in `.env` files committed to repo. Concrete mechanism depends on chosen provider (Railway secrets, Fly.io secrets, AWS SSM, etc.) but the interface is always: inject as env vars at runtime.

| Secret | Variable Name | Rotation Strategy |
|--------|--------------|-------------------|
| JWT Access Secret | `JWT_ACCESS_SECRET` | Rotate every 90 days; old tokens expire in 15 min naturally |
| JWT Refresh Secret | `JWT_REFRESH_SECRET` | Rotate every 180 days; requires forced re-login |
| PostgreSQL URL | `DATABASE_URL` | Managed by DB provider; rotate via provider dashboard |
| Redis URL | `REDIS_URL` | Managed by Redis provider |
| Telegram Bot Token | `TELEGRAM_BOT_TOKEN` | Rotate via @BotFather if compromised |
| Firebase Service Account | `FIREBASE_SERVICE_ACCOUNT_JSON` | Platform secret (JSON string); rotate via Firebase console |
| S3 Backup Credentials | `BACKUP_S3_ACCESS_KEY` + `BACKUP_S3_SECRET_KEY` | Rotate every 90 days via storage provider dashboard |
| Webhook HMAC Secret | `WEBHOOK_HMAC_SECRET` | Per-establishment, stored in `webhooks.secret` column |

**Rules:**
- `.env` files are in `.gitignore` — a pre-commit hook validates this
- Staging and production have **separate secret sets** (different values, same variable names)
- `DATABASE_URL` includes `?connection_limit=20&pool_timeout=10`
- Separate secret for non-sensitive config (e.g. feature flags) vs credentials

---

## 11. 🧪 Testing Strategy

> **NEW — Тестова стратегія (Eng Review)**
>
> При вайб-кодінгу + AI вартість тестів у 100x дешевша.
> Інструменти: **Jest** (unit + integration), **Supertest** (HTTP endpoints).

### Типи тестів

| Тип | Що покриває | Пріоритет |
|-----|-------------|-----------|
| **Unit** | Окремі функції: статусна машина `deliveries`, `geo_match` логіка, розрахунок дат retention | P0 |
| **Integration** | `TrackingModule`: ping → Redis → WS. `ProofOfDelivery`: complete → INSERT. Retention: cron → кількість видалених. Orders: дублікат `external_id` → ON CONFLICT → один запис | P0 |
| **Multi-tenant** | Менеджер закладу A отримує тільки свої дані. Дані закладу B недоступні. | P0 |
| **API (Supertest)** | Всі ендпоінти: авторизація, Zod-валідація, HTTP-статуси | P1 |
| **E2E** | Повний ланцюжок: замовлення → призначення → GPS-пінги → Proof of Delivery → completed | P1 |

### Критичні тест-кейси (не можна пропустити)

| Тест-кейс | Модуль | Чому важливо |
|-----------|--------|--------------|
| Гео-пруф поза 300м → `geo_match=false`, але доставка зараховується | `ProofOfDelivery` | Не блокувати кур'єра, але фіксувати |
| Дублікат webhook від Poster → один order в БД | `Orders` + `Integrations` | `ON CONFLICT DO NOTHING` |
| `retention_days` не встановлено → нічого не видаляється | `Retention` | Безпечний default |
| `delivery_proofs` не видаляються ні при якому retention | `Retention` | Захист доказів від спорів |
| Telegram недоступний → proof of delivery зберігається | `Notifications` + `PoD` | Fire-and-forget не блокує |
| 100 одночасних пінгів → всі записані, WS отримав оновлення | `Tracking` | Connection pool + pub/sub |
| WS підключення з невалідним JWT → з'єднання відхилено | `TrackingGateway` | **NEW** WS auth security |
| Менеджер закладу A не отримує events закладу B через WS | `TrackingGateway` | **NEW** Multi-tenant WS isolation |
| Офлайн пруф надісланий після скасування замовлення → 400/409, не 500 | `ProofOfDelivery` | **NEW** Offline queue edge case |
| Невалідний перехід статусу (`completed → in_progress`) → відхилено | `OrdersModule` | **NEW** State machine guard |
| `plan='trial'` + `trial_ends_at` + 7 днів grace минуло → HTTP 402 | `EstablishmentsModule` | **NEW** Billing gate |
| iiko polling при API 5xx → помилка залогована, наступний polling не падає | `IntegrationsModule` | **NEW** Resilience |

---

## 12. 📊 State Machines

### Orders State Machine

```
pending → assigned → in_progress → completed
        ↘ cancelled  ↘ cancelled   ↘ failed
```

**DB constraint:**
```sql
status TEXT CHECK (status IN ('pending','assigned','in_progress','completed','cancelled','failed'))
```

**States:**

| Стан | Опис |
|------|------|
| `pending` | Замовлення створено, кур'єр не призначений |
| `assigned` | Кур'єр призначений, ще не забрав |
| `in_progress` | Кур'єр забрав замовлення, в дорозі |
| `completed` | Доставлено, GPS-пруф зафіксовано |
| `cancelled` | Скасовано менеджером (до початку доставки) |
| `failed` | Доставка не відбулась (повернення, відмова клієнта) |

**Transition table:**

| From | To | Trigger | Actor |
|------|----|---------|-------|
| `pending` | `assigned` | `POST /api/v1/orders/:id/assign` | Manager/System |
| `pending` | `cancelled` | `PATCH /api/v1/orders/:id/cancel` | Manager |
| `assigned` | `in_progress` | `PATCH /api/v1/deliveries/:id/start` | Courier |
| `assigned` | `cancelled` | `PATCH /api/v1/orders/:id/cancel` | Manager |
| `in_progress` | `completed` | `POST /api/v1/deliveries/:id/complete` | Courier |
| `in_progress` | `failed` | `PATCH /api/v1/deliveries/:id/fail` | Courier/System |

**DB actions on transition:**

| Transition | DB Effect |
|------------|-----------|
| `pending → assigned` | `UPDATE orders SET status='assigned'` · `INSERT deliveries (status='assigned', assigned_at=NOW())` |
| `pending → cancelled` | `UPDATE orders SET status='cancelled'` |
| `assigned → in_progress` | `UPDATE orders SET status='in_progress'` · `UPDATE deliveries SET status='in_progress', started_at=NOW()` |
| `assigned → cancelled` | `UPDATE orders SET status='cancelled'` · `UPDATE deliveries SET status='failed'` |
| `in_progress → completed` | `UPDATE orders SET status='completed'` · `UPDATE deliveries SET status='completed', completed_at=NOW(), order_closed_at=NOW()` · `INSERT delivery_proofs` |
| `in_progress → failed` | `UPDATE orders SET status='failed'` · `UPDATE deliveries SET status='failed', completed_at=NOW()` |

---

### Deliveries State Machine

```
assigned → in_progress → completed
                ↘ failed
```

**DB constraint:**
```sql
status TEXT CHECK (status IN ('assigned','in_progress','completed','failed'))
```

> **MVP decision:** `picked_up` state removed — one tap for courier ("start delivery" = picked up + departed). Simpler UX, fewer endpoints, fewer tests. If warehouse-style pickup tracking is needed in V2, add `picked_up` back.

**States:**

| Стан | Опис |
|------|------|
| `assigned` | Кур'єр призначений на доставку |
| `in_progress` | Кур'єр забрав замовлення і в дорозі до клієнта |
| `completed` | Доставлено клієнту, GPS-пруф збережено |
| `failed` | Доставка не відбулась |

**Note:** `deliveries.status` синхронізується з `orders.status` в рамках однієї транзакції при кожному переході.

---

## 13. 🚀 CI/CD та середовища

> **Vendor-agnostic:** GitHub Actions pipeline (нижче) — незалежний від хостинг-провайдера. Кроки `deploy-staging` та `deploy-prod` містять placeholder для CLI конкретного провайдера (Railway, Fly.io, Render, тощо). Замінити один крок деплою — без змін в решті pipeline.

### Environments

| Environment | Branch | Purpose | Hosting |
|-------------|--------|---------|---------|
| Development | feature/* | Local dev | Local docker-compose |
| Staging | main | Integration testing | Провайдер на вибір (staging service) |
| Production | tags v*.*.* | Live users | Провайдер на вибір (prod service) |

### GitHub Actions Pipeline

```yaml
# .github/workflows/deploy.yml
name: CI/CD Pipeline

on:
  push:
    branches: [main]
    tags: ['v*.*.*']
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgis/postgis:15-3.3
        env:
          POSTGRES_PASSWORD: test
          POSTGRES_DB: weego_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
      redis:
        image: redis:7-alpine
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npx prisma migrate deploy
        env:
          DATABASE_URL: postgresql://postgres:test@localhost/weego_test
      - run: npm test
        env:
          DATABASE_URL: postgresql://postgres:test@localhost/weego_test
          REDIS_URL: redis://localhost:6379
          JWT_ACCESS_SECRET: test-secret-ci
          JWT_REFRESH_SECRET: test-refresh-secret-ci

  deploy-staging:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to Staging
        # Replace with provider-specific CLI command:
        # Railway:  npx @railway/cli up --service ${{ secrets.STAGING_SERVICE_ID }}
        # Fly.io:   flyctl deploy --app weego-staging
        # Render:   curl -X POST ${{ secrets.RENDER_STAGING_DEPLOY_HOOK }}
        run: echo "TODO: add deploy command for chosen provider"
        env:
          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}

  deploy-prod:
    needs: test
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    environment: production  # requires manual approval in GitHub
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to Production
        # Replace with provider-specific CLI command (same as staging, different service/app)
        run: echo "TODO: add deploy command for chosen provider"
        env:
          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}
```

### Start Command (будь-який провайдер)

Prisma migrations run automatically before the server starts on every deploy:

```
npx prisma migrate deploy && node dist/main.js
```

### Rollback Procedure

1. Hosting provider dashboard → find previous healthy deployment → **Rollback/Redeploy**
2. If a DB migration ran alongside the bad deploy: restore from provider's DB backup (see Section 15)
3. **Zero-downtime migration strategy** — always use additive migrations:
   - Step 1: add column as `nullable` (no breaking change)
   - Step 2: deploy code that writes to the new column
   - Step 3: backfill existing rows
   - Step 4: remove the old column in a subsequent deploy

### GitHub Secrets Required

| Secret | Description |
|--------|-------------|
| `DEPLOY_TOKEN` | Hosting provider API token (project-scoped) |
| *(provider-specific)* | Any additional service IDs or deploy hooks required by the chosen provider |

Set these under **Settings → Secrets and variables → Actions** in the GitHub repository. The `production` environment should have a required reviewer configured so `deploy-prod` never runs without manual approval.

---

## 14. 🔍 Observability та Monitoring

### Health Check Endpoint

Add a `GET /health` endpoint to NestJS (used by Railway health checks and uptime monitoring):

```typescript
// GET /health
// Response shape
{
  "status": "ok",
  "timestamp": "2026-03-21T12:00:00Z",
  "services": {
    "database": "ok",   // confirmed via SELECT 1
    "redis": "ok",      // confirmed via redis.ping()
    "version": "1.2.0"  // read from package.json
  }
}
```

Implementation notes:
- Use `@nestjs/terminus` (`HealthModule`) — it provides `TypeOrmHealthIndicator` and `MicroserviceHealthIndicator` out of the box.
- Return HTTP 200 when all checks pass, HTTP 503 when any check fails.
- Railway should be configured to hit `/health` as its health-check path so unhealthy instances are removed from routing before they receive real traffic.

### Three-Layer Monitoring Stack

| Layer | Tool | What it monitors | Cost |
|-------|------|-----------------|------|
| Uptime | BetterStack (free tier) | `/health` endpoint, alerts if down > 1 min | Free |
| Errors | Sentry (free tier) | Unhandled exceptions, slow queries > 1s | Free |
| Logs | Platform built-in logs | Structured JSON logs (provider-agnostic) | Included |

### Structured Logging with Winston

All application logs must be emitted as JSON so Railway's log parser can index fields:

```typescript
// Example log entry — every log must include these fields
{
  "level": "info",
  "message": "Order assigned",
  "orderId": "uuid",
  "courierId": "uuid",
  "establishmentId": "uuid",
  "timestamp": "2026-03-21T12:00:00Z"
}
```

Winston configuration:

```typescript
// logger.config.ts
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';

export const loggerConfig = WinstonModule.forRoot({
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json(),   // structured output for Railway
      ),
    }),
  ],
});
```

Never log PII (phone numbers, addresses) or sensitive tokens. Use IDs only in log fields.

### BetterStack Alert Rules

| Alert | Condition | Action |
|-------|-----------|--------|
| API down | `/health` returns non-200 for > 1 min | Telegram message to admin |
| Slow API | Response time > 3s for 3 consecutive checks | Warning notification |
| Retention cron failed | Detected via `NotificationsModule` in `RetentionModule` | Alert via existing notification pipeline |

### Error Budget

| Metric | MVP Target |
|--------|-----------|
| SLO | 99.5% uptime |
| Allowed downtime | ≈ 3.6 hours / month |
| Review cadence | Monthly — check Railway metrics + BetterStack report |

At MVP stage 99.5% is appropriate. Revisit to 99.9% once paying customers exceed 20 active establishments.

### Sentry Integration

```typescript
// main.ts — initialise before NestFactory
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,   // 'staging' | 'production'
  tracesSampleRate: 0.1,               // 10% of transactions for performance
});
```

Add `SENTRY_DSN` to Railway environment variables for both staging and production services (use separate Sentry projects so staging noise does not pollute production alerts).

---

## 15. 💾 Backup та Disaster Recovery

### Recovery Targets

| Metric | Target | Rationale |
|--------|--------|-----------|
| RPO (max acceptable data loss) | 24 hours | Daily backups sufficient for MVP |
| RTO (time to restore service) | 4 hours | Railway restore ~30 min + app restart ~5 min + verification ~30 min |

### Backup Layers

| Layer | What | Frequency | Retention | Storage |
|-------|------|-----------|-----------|---------|
| Provider managed backup | Full PostgreSQL dump (built-in) | Daily | 7+ days | Managed by provider |
| `delivery_proofs` JSON export | Critical table — legal evidence | Weekly (cron Sunday 02:00) | 90 days | S3-compatible storage |

The provider's managed daily backup covers the RPO requirement. The weekly `delivery_proofs` JSON export (via Prisma, no `pg_dump`) provides an off-platform copy that survives any provider-side incident. This is the only backup that runs inside the NestJS application.

### Weekly Backup Cron

> **Implementation note:** Use Prisma queries + JSON export instead of `pg_dump`. `pg_dump` is a system binary not available in Node.js containers. The platform provider's managed backup handles full DB dumps — the NestJS cron only needs to export critical tables to off-platform storage.

Add to `RetentionModule` (or a dedicated `BackupModule`):

```typescript
@Cron('0 2 * * 0')  // Every Sunday at 02:00
async weeklyDeliveryProofsBackup() {
  try {
    // Export delivery_proofs (critical — never deleted, needed for disputes)
    const proofs = await this.prisma.delivery_proofs.findMany({
      where: { created_at: { gte: subDays(new Date(), 7) } }
    });

    const payload = Buffer.from(JSON.stringify(proofs));
    const dateStr = format(new Date(), 'yyyy-MM-dd');

    // Upload to S3-compatible storage (env var: S3_ENDPOINT, S3_BUCKET)
    await this.s3.send(new PutObjectCommand({
      Bucket: process.env.BACKUP_S3_BUCKET,
      Key: `delivery-proofs/${dateStr}.json.gz`,
      Body: gzipSync(payload),
    }));

    this.logger.log({ message: 'Weekly backup completed', proofCount: proofs.length });
  } catch (err) {
    this.logger.error({ message: 'Weekly backup FAILED', error: err.message });
    // Alert via NotificationsModule
  }
}
```

S3 bucket layout (any S3-compatible provider — Cloudflare R2, AWS S3, Backblaze B2):

```
{BACKUP_S3_BUCKET}/
  delivery-proofs/
    2026-03-22.json.gz    ← weekly export of delivery_proofs
    2026-03-29.json.gz
    ...
```

Environment variables required:
```
BACKUP_S3_BUCKET=weego-backups
BACKUP_S3_ENDPOINT=https://...   # provider-specific
BACKUP_S3_ACCESS_KEY=...
BACKUP_S3_SECRET_KEY=...
```

Full PostgreSQL dump is handled by the managed database provider's built-in backup system (required capability — see Section 9 checklist). Never implement pg_dump inside the application container.

### Restore Procedure

1. **Hosting provider dashboard** → Database → Backups → select target backup → **Restore**
2. Wait for restore to complete (typically 10–30 min depending on DB size)
3. Verify data integrity:
   ```sql
   SELECT COUNT(*) FROM orders;
   SELECT COUNT(*) FROM delivery_proofs;
   SELECT MAX(created_at) FROM orders;  -- confirms how recent the backup is
   ```
4. Restart the API service (provider dashboard → Service → Restart)
5. Smoke-test `/health` and one or two key API endpoints
6. Notify affected establishments via the existing `NotificationsModule`

### Tables That Are Never Deleted

Regardless of any retention policy, data purge job, or manual cleanup:

| Table | Reason |
|-------|--------|
| `delivery_proofs` | Legal evidence of delivery; required indefinitely |
| `retention_logs` | Audit trail of all data retention actions |
| `users` | Account history; required for support and compliance |

These tables must be explicitly excluded from any bulk-delete queries in `RetentionModule`. Add a guard check at the start of every retention job that verifies it is not targeting these tables before executing any `DELETE` or `TRUNCATE`.

---

## 16. 🎨 UX Specification

> **Scope:** Structural UX decisions — screens, navigation, information hierarchy, interaction states, user flows. Visual design (colors, typography, spacing scale) is decided during implementation. All decisions below follow established mobile/web UX best practices.

---

### 16.1 Courier Mobile App (React Native)

#### Navigation Pattern

**Bottom Tab Bar — 3 tabs:**
```
┌─────────────────────────────────┐
│                                 │
│          [Screen Content]       │
│                                 │
├──────────┬──────────┬───────────┤
│  📦      │  🕐      │  👤       │
│ Активні  │ Історія  │ Профіль   │
└──────────┴──────────┴───────────┘
```
Rationale: 3 tabs is the minimum viable nav. Courier primary job = active orders. History = secondary. Profile = rarely used (end shift, settings). No hamburger menu — too slow for operational tool.

#### Screens & Information Hierarchy

**Screen 1 — Onboarding / Login**
```
Priority 1: Logo + app name (trust signal, 5-sec visceral)
Priority 2: Phone number field (primary action)
Priority 3: "Отримати код" button (full-width, 48px height min)
Below fold:  Terms of Service link
```
Best practice: Phone-based auth (not email) — courier audience. SMS OTP on next screen.

**Screen 2 — GPS Consent (one-time, shown after first login)**
```
Priority 1: Simple icon (GPS pin or location)
Priority 2: Explanation (2 sentences max): "Додаток відстежує твоє місцезнаходження 
            тільки під час активної зміни. Без твоєї згоди трекінг не запускається."
Priority 3: [Погоджуюсь та продовжити] — primary button (full-width)
Priority 4: [Дізнатись більше] — text link → Privacy Policy
```
Required: Legal compliance (ЗУ №2297-VI). Must be explicit opt-in, not buried in ToS. Stored as `courier.gps_consent_at TIMESTAMP`.

**Screen 3 — Active Orders (Tab 1, main screen)**

*State: Loading*
```
3 skeleton cards (gray animated placeholders, same height as real cards)
No text during loading — skeletons communicate "something is coming"
```

*State: Empty (no orders assigned)*
```
Priority 1: Illustration (courier waiting — simple, not generic)
Priority 2: "Замовлень поки немає"  (large, ~20px)
Priority 3: "Менеджер побачить тебе на карті та призначить замовлення" (secondary text)
Priority 4: [Зв'язатись з менеджером] — Telegram deep link (optional)
```
Rationale: empty state explains WHY and what to expect, reduces courier anxiety.

*State: Active order present*
```
┌─────────────────────────────────┐
│ 🔴 НОВЕ ЗАМОВЛЕННЯ              │  ← colored status chip
│                                 │
│ вул. Хрещатик 22                │  ← address (large, 18px)
│ Кв. 14                          │
│                                 │
│ 📦 3 позиції  •  ~2.1 км        │  ← details row
│                                 │
│ ────────────────────────────── │
│                                 │
│    [🚀 Прийняти замовлення]     │  ← PRIMARY action, full-width
│                                 │
│    ⏱ Залишилось 2:47           │  ← countdown timer (3 min timeout)
└─────────────────────────────────┘
```

*State: Multiple orders (future — V2)*
List of cards, newest/most urgent first. Scrollable.

**Screen 4 — Order Detail**

Information hierarchy:
```
Priority 1: Status chip + action button (what to do NOW)
Priority 2: Address + "Прокласти маршрут" (opens Apple/Google Maps)
Priority 3: Order items summary (collapsed by default)
Priority 4: Customer phone (tap to call)
Priority 5: Notes from manager (if any)

Action buttons by status:
  assigned   → [Забрав замовлення] (blue, full-width)
  in_progress→ [Доставлено — GPS пруф] (green, full-width)
  completed  → [Переглянути пруф]  (gray, outline)
```

**Screen 5 — Proof of Delivery**
```
┌─────────────────────────────────┐
│ ← Доставка #1234                │
│                                 │
│  [  GPS ФІКСУЄТЬСЯ...  ]        │  ← loading state with pulse animation
│     📍 Точність: 12м            │  ← accuracy indicator
│                                 │
│  ┌─────────────────────────┐   │
│  │  Міні-карта з позицією  │   │  ← leaflet map, 200px height
│  │  кур'єра та адресою     │   │
│  └─────────────────────────┘   │
│                                 │
│  [+ Додати фото (необов'язково)] │  ← secondary action
│                                 │
│  [✅ Підтвердити доставку]       │  ← PRIMARY, disabled until GPS locked
│                                 │
└─────────────────────────────────┘
```

*State: GPS accuracy > 100m*
```
⚠️ "Слабкий сигнал GPS ({{N}}м). Можеш підтвердити, але менеджер побачить низьку точність."
Button: stays enabled — do NOT block delivery. Flag in geo_flags only.
```

*State: GPS unavailable (airplane mode / disabled)*
```
❌ "GPS недоступний. Увімкни геолокацію в налаштуваннях."
[Відкрити налаштування] — deep link to device settings
Button: disabled until GPS available
```

*State: Offline (no internet)*
```
Banner: "📵 Офлайн — пруф буде надіслано автоматично при підключенні"
Button: enabled — save to local queue (expo-sqlite)
```

#### Proof of Delivery — Full Confirmed Flow

```
Step 1: Courier taps "Доставлено — GPS пруф" on Order Detail screen

Step 2: Confirmation screen (shows before submitting to server)
┌─────────────────────────────────┐
│ Підтвердити доставку            │
│                                 │
│ Замовлення #1234                │
│ вул. Хрещатик 22, кв. 14        │
│                                 │
│ 📍 GPS: 48.4501, 34.9898        │
│    Точність: 12м                │
│                                 │
│ ℹ️ Ці координати будуть         │
│    збережені як підтвердження   │
│                                 │
│ [📷 Додати фото (необов'язково)]│
│                                 │
│ [✅ Підтвердити]  [← Назад]    │
└─────────────────────────────────┘

Step 3: Submit → success flash (1.5 sec auto-dismiss, no action required)
┌─────────────────────────────────┐
│                                 │
│         ✅                      │
│   Доставлено!                   │
│   вул. Хрещатик 22              │
│                                 │
└─────────────────────────────────┘
↓ auto-returns to HOME (Active Orders tab) after 1.5 sec

Decision: No stats overlay, no choices. Couriers are operational users
— every extra decision = friction. Daily stats available in History tab.
Completed deliveries badge: subtle counter on History tab icon shows
today's count (e.g. "5") — always visible, never interrupts flow.
```

**Screen 6 — History (Tab 2)**
```
Filter strip: Сьогодні | Тиждень | Місяць
List: delivery cards sorted by date desc
  Each card: address, time, status chip (completed/failed), geo_match indicator
Empty: "Доставок ще немає. Вони з'являться тут після першої доставки."
```

**Screen 7 — Profile (Tab 3)**
```
Priority 1: Name + phone number (identity confirmation)
Priority 2: [🔴 Завершити зміну] — stops GPS tracking (legal compliance)
Priority 3: [🟢 Розпочати зміну] — starts GPS tracking
Priority 4: App version + Privacy Policy link
```

Rationale: "Завершити зміну" is the legal GPS-off mechanism required by ЗУ №2297-VI. Must be visually prominent, not buried.

---

### 16.2 Manager Web Dashboard (Next.js)

#### Navigation Pattern

**Left sidebar (desktop, ≥ 1024px):**
```
┌────────────┬──────────────────────────────────┐
│  @weego    │                                  │
│  [logo]    │     [Main Content Area]          │
│            │                                  │
│  🗺 Карта  │                                  │
│  📋 Замовл │                                  │
│  👥 Кур'єри│                                  │
│  📊 Аналіт │                                  │
│  ⚙️ Налашт  │                                  │
│            │                                  │
│  [Вийти]   │                                  │
└────────────┴──────────────────────────────────┘
```

**Mobile (< 768px): Bottom tab bar** — same 5 items, icons only.
Rationale: Dashboard is primarily desktop tool (manager at workstation), but must work on mobile for field checks.

#### Screens & Information Hierarchy

**Screen 1 — Live Map (default/home screen)**
```
Layout: Full-screen map + overlay panels

MAP LAYER:
  - Courier pins (colored by status: green=active, gray=idle >2min, red=issue)
  - Order pins (pending orders visible as markers)
  - Click courier pin → courier card expands

TOP BAR (overlay):
  [Встановлення: Піцерія Маріо ▼]   [+Замовлення]   [🔔 2]

RIGHT PANEL (collapsible, 320px):
  "Активні замовлення (4)"
  ├── Order card: pending + [Призначити ▼]
  ├── Order card: in_progress + courier name + ETA
  └── ...

BOTTOM STRIP:
  👥 3 кур'єри онлайн  •  📦 2 очікують  •  🚚 4 в дорозі
```

*State: Loading (WebSocket connecting)*
```
Map loads immediately (Leaflet/OSM has no auth gate)
Top banner: "Підключення до live-трекінгу..." with spinner
Courier pins: skeleton pulse animation
```

*State: Empty (no couriers connected)*
```
Map renders normally
Center card overlay:
  "Додайте першого кур'єра"
  "Надішліть запрошення — кур'єр встановить додаток за 2 хвилини"
  [+ Запросити кур'єра]  ← primary action
```

*State: WebSocket disconnected*
```
Top banner (red): "⚠️ З'єднання перервано — позиції можуть бути застарілими. Спроба підключення..."
Map remains visible with last-known positions, pins grayed out
Auto-reconnects via Socket.io built-in backoff
```

**Screen 2 — Orders List**
```
Filters: Всі | Очікують | В дорозі | Завершені
Search: за адресою або номером замовлення

Table/list columns:
  # | Адреса | Кур'єр | Статус | Час створення | Дії

Status chips (color-coded):
  pending    → yellow "Очікує"
  assigned   → blue "Призначено"
  in_progress→ orange "В дорозі"
  completed  → green "Доставлено"
  failed     → red "Не доставлено"
  cancelled  → gray "Скасовано"
```

*State: Empty (no orders today)*
```
Illustration: empty clipboard
"Замовлень сьогодні ще немає"
"Вони з'являться тут автоматично після інтеграції з POS або ручного введення"
[+ Додати замовлення вручну]
```

**Screen 3 — Order Detail (modal or side panel)**
```
Priority 1: Status + timeline (created → assigned → in_progress → completed)
Priority 2: Delivery address + mini-map
Priority 3: Assigned courier (name + last seen)
Priority 4: Proof of delivery (GPS coordinates + accuracy + photo if exists)
Priority 5: Actions: [Призначити] / [Перепризначити] / [Скасувати]
```

**Screen 4 — Couriers List**
```
Table: Ім'я | Телефон | Статус | Остання активність | Доставок сьогодні | Дії

Status indicators:
  🟢 Онлайн (ping < 2 min ago)
  🟡 Неактивний (ping 2–10 min ago)
  ⚫ Офлайн (ping > 10 min ago або shift ended)

Empty state:
  "Кур'єрів ще немає"
  "Запросіть першого кур'єра — він отримає посилання для встановлення додатку"
  [+ Запросити кур'єра]
```

**Screen 5 — Analytics**
```
Date range picker: Сьогодні | Тиждень | Місяць | Власний діапазон

Cards row (KPIs):
  📦 Всього доставок  |  ✅ Успішних  |  ⏱ Сер. час  |  ❌ Зірваних

Chart: Доставки по днях (line chart — відображає тренд)

Couriers table:
  Кур'єр | Доставок | Середній час | Geo match % | Зірвані

Empty state (new account):
  "Статистика з'явиться після перших доставок"
```

**Screen 6 — Settings**
```
Sections (tabs or accordion):
  👥 Команда         → список менеджерів + [+ Запросити менеджера]
  🔌 Інтеграції      → Poster / iiko / Webhooks
  🗑️ Зберігання даних → retention_days + retention_pings_days sliders
  💳 Тариф           → поточний план + [Оновити] (owner only)
  📄 Документи        → Privacy Policy, Terms of Service, DPA
```

---

### 16.3 Interaction States — Complete Reference

```
FEATURE                  | LOADING          | EMPTY                    | ERROR                    | SUCCESS
-------------------------|------------------|--------------------------|--------------------------|-------------------
Live map (WS)            | Skeleton pins    | Onboarding CTA           | Red banner + stale data  | Live pins update
Orders list              | Skeleton rows    | Empty illustration + CTA | "Не вдалось завантажити" | List renders
Order assignment         | Button spinner   | n/a                      | Toast: "Помилка"         | Status chip updates
Proof of delivery        | GPS pulse anim   | n/a                      | GPS error message        | Confetti/✅ screen
Courier invite send      | Button spinner   | n/a                      | Toast: "Помилка надсилання"| "Посилання надіслано"
Analytics                | Skeleton charts  | "Даних ще немає"         | "Не вдалось завантажити" | Charts render
Settings save            | Button spinner   | n/a                      | Inline error             | "Збережено ✓" toast
```

---

### 16.4 Trial Expiry / 402 State

**Dashboard (manager sees):**
```
┌─────────────────────────────────────────┐
│                                         │
│  🔒 Пробний період завершився           │
│                                         │
│  Ваш 14-денний trial закінчився.        │
│  Для продовження роботи — оберіть тариф.│
│                                         │
│  [Переглянути тарифи]  ← primary        │
│  [Зв'язатись з нами]   ← secondary      │
│                                         │
│  💡 Ваші дані збережені та чекають.     │
│                                         │
└─────────────────────────────────────────┘
```
Full-screen overlay (not a toast) — this is a blocking state.
Map, orders, analytics: read-only behind the overlay. Courier app: continues working 7 more days.

---

### 16.5 Accessibility Baseline (WCAG 2.1 AA)

| Requirement | Specification |
|-------------|---------------|
| Touch targets | Min 44×44px for all interactive elements (Apple HIG + Material) |
| Color contrast | Min 4.5:1 for text, 3:1 for large text and UI components |
| Focus indicators | Visible keyboard focus ring on all interactive elements (web) |
| Screen reader | All images have alt text; interactive elements have aria-labels |
| Error messages | Never communicated by color alone — always include text/icon |
| Form labels | All inputs have associated `<label>` elements |
| Loading states | Announce to screen reader via `aria-live="polite"` |

---

### 16.6 Responsive Breakpoints (Web Dashboard)

| Breakpoint | Layout |
|------------|--------|
| ≥ 1024px (desktop) | Left sidebar + main content area |
| 768–1023px (tablet) | Collapsed sidebar (icons only) + main content |
| < 768px (mobile) | Bottom tab bar + full-width content |

Map view on mobile: full-screen map, bottom sheet for orders list (swipe up to expand).

---

### 16.7 Key UX Principles for This Product

1. **Courier app: speed over beauty.** Courier is driving or carrying orders — every interaction must be 1 tap max for primary actions. No dialogs, no confirmations on the critical path.
2. **Dashboard: information density is a feature.** Manager needs to see everything at once — don't hide data behind clicks. Live map + active orders visible simultaneously.
3. **Never block on GPS accuracy.** Low accuracy = flag + warn, never block. Blocking a courier mid-delivery is a catastrophic UX failure.
4. **Offline is a first-class state.** Couriers are in basements, parking garages, elevators. Show offline state clearly, queue actions silently, sync automatically.
5. **Empty states are onboarding.** The first time a manager opens the dashboard, it's empty. That empty state IS the onboarding — it tells them exactly what to do next.

---

### 16.8 Design System Note

No DESIGN.md exists yet. **When to create it:** before writing the first UI component. At that point, define at minimum:
- Color tokens (primary, secondary, status colors for order states)
- Typography scale (heading, body, caption — 3 sizes is enough for MVP)
- Spacing scale (8px base unit — 4, 8, 16, 24, 32, 48px)
- Component vocabulary: Button (primary/secondary/ghost), Card, Badge, Input, Toast

Recommended tool: shadcn/ui (already in tech stack) provides sensible defaults. Customize tokens in `tailwind.config.ts`. Start with shadcn's default theme, override as needed — don't design from scratch.

For the mobile app (React Native): use a consistent spacing scale (same 8px base) and StyleSheet constants. No external UI library needed for MVP — custom components with consistent primitives are sufficient.


---

## 17. 🛡️ Pre-Mortem Mitigations (The Fool Audit)

> **Додано після adversarial аудиту (2026-03-21)**
>
> Нижче — конкретні архітектурні рішення для п'яти failure-сценаріїв, виявлених після трьох раундів CEO / Eng / Design review. Всі рішення погоджені до реалізації.

---

### 17.1 Adoption Guard — Курʼєр не відкриває додаток

**Проблема:** Курʼєр встановив додаток, але "забуває" відкрити. Менеджер не знає — карта порожня.

#### Push при призначенні (вже частково є, тепер — специфікація)

При `POST /api/v1/orders/:id/assign`:
```
[async] Firebase FCM push до курʼєра:
  title: "Нове замовлення #{ order.number }"
  body:  "{ address } · { client_name }"
  data:  { delivery_id, deep_link: "weego://deliveries/{id}" }
```
Тап на push-повідомлення → додаток відкривається одразу на екрані цієї доставки. Жодної зайвої дії.

#### Auto-reminder якщо нема пінгу через 2 хвилини

Після призначення: якщо курʼєр не надіслав жодного GPS-пінгу за 2 хвилини → автоматичний повторний push:
```
title: "Доставка чекає"
body:  "Підтвердіть замовлення #{ order.number }"
data:  { delivery_id, deep_link }
```
Реалізація: `Bull` delayed job з `delay: 2 * 60 * 1000`, скасовується при першому пінгу або старті доставки.

#### Статус курʼєра на дашборді менеджера

Кожен курʼєр на карті та у списку має кольоровий індикатор:

| Стан | Умова | Відображення |
|------|-------|--------------|
| 🟢 Онлайн | Останній пінг < 30 сек тому | Зелена крапка |
| 🟡 Можливо у фоні | Пінг 30 сек – 5 хв тому | Жовта крапка + "Х хв тому" |
| 🔴 Не відповідає | Пінг > 5 хв під час активної доставки | Червона крапка + кнопка [Нагадати] |
| ⚫ Офлайн | Немає активної доставки + пінг > 5 хв | Сіра крапка (не тривожний стан) |

Кнопка **[Нагадати]** → надсилає push курʼєру (те саме повідомлення що auto-reminder).

**Новий рядок у БД (логування нагадувань):**
```sql
-- у таблиці deliveries:
last_reminder_sent_at  TIMESTAMP  -- коли надіслано останнє нагадування курʼєру
reminder_count         INT DEFAULT 0  -- щоб не спамити
```

**Правило анти-спаму:** не більше 1 нагадування на 3 хвилини по одній доставці.

---

### 17.2 Founder Billing Panel — Адмін-панель для засновника

**Проблема:** При 20+ закладах ручне відстеження тріалів і виставлення рахунків стає другою роботою.

#### Нова сторінка: `/admin` (тільки для `role='owner'` + `is_platform_admin=true`)

> Це **не** клієнтська сторінка — тільки для засновника продукту.

**Таблиця всіх закладів:**

| Заклад | Тариф | Тріал до | Оплачено до | Статус | Дія |
|--------|-------|----------|-------------|--------|-----|
| Піцерія Марко | starter | 24 берез | — | ⚠️ Закінчується | [Надіслати рахунок] |
| Суші Хаус | business | — | 30 квіт | ✅ Активний | — |

#### Кнопка [Надіслати рахунок]

```
POST /api/v1/admin/billing/send-invoice { establishment_id }
  → генерує Monobank посилання (або текст рахунку для ФОП)
  → надсилає власнику закладу через Telegram (якщо підключений) або повертає текст для копіювання
  → INSERT billing_events (establishment_id, sent_at, amount, type='invoice')
```

#### Автоматичні Telegram-алерти засновнику

```
@Cron("0 9 * * *")  -- щоранку 09:00
  → SELECT establishments WHERE trial_ends_at BETWEEN NOW() AND NOW() + 3 days
  → якщо є → Telegram засновнику: "Тріал закінчується: [Заклад] — { дата }"

  → SELECT establishments WHERE trial_ends_at < NOW() AND paid_until IS NULL
  → якщо є → Telegram засновнику: "Тріал закінчився без оплати: [Заклад]. Надіслати рахунок?"
```

**Нові таблиці:**
```sql
billing_events (
  id                UUID PRIMARY KEY,
  establishment_id  UUID REFERENCES establishments(id),
  type              TEXT CHECK (type IN ('invoice_sent','payment_confirmed','plan_changed')),
  amount_usd        NUMERIC(10,2),
  notes             TEXT,
  created_at        TIMESTAMP DEFAULT NOW()
)
```

**Новий прапорець у users:**
```sql
is_platform_admin  BOOLEAN DEFAULT false  -- тільки засновник продукту
```

---

### 17.3 Manager Dashboard PWA + Mobile-First

**Проблема:** Дашборд — веб-сайт на ноутбуці. Відключення світла → ноутбук вимкнений → менеджер не бачить карту. Телефон на акумуляторі — але сайт не адаптований.

#### Mobile-first responsive layout (вже частково в Section 16, тепер — технічна специфікація)

```
< 768px (телефон):
  - Карта на весь екран
  - Bottom sheet: список активних доставок (свайп вгору для деталей)
  - FAB кнопка: [+ Нове замовлення]
  - Відсутній sidebar — навігація через bottom tab bar (Section 16)

≥ 768px (планшет/десктоп):
  - Стандартний layout з sidebar (Section 16)
```

**Мета:** менеджер може повноцінно керувати доставками з телефону під час відключення світла.

#### PWA (Progressive Web App)

```
next.config.ts:
  - next-pwa плагін
  - Service Worker: кешує shell + останні позиції курʼєрів

При втраті WebSocket:
  - Показує "Немає зʼєднання — відображаються останні відомі позиції"
  - localStorage: { courier_id: { lat, lng, updated_at } } — оновлюється при кожному courier_moved events
  - Маркери на карті залишаються на останніх відомих позиціях (сірі = офлайн-дані)

При відновленні:
  - Автоматичний reconnect Socket.io
  - Маркери оновлюються до live-даних
  - Банер "Зʼєднання відновлено" (авто-зникає через 3 сек)
```

**Нова залежність:**
```
npm install next-pwa
```

**Manifest:**
```json
{
  "name": "@weego CMI",
  "short_name": "Weego",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#000000",
  "icons": [...]
}
```

Менеджер може додати дашборд на головний екран телефону — виглядає і відчувається як нативний додаток.

---

### 17.4 Пріоритети реалізації (з цього розділу)

| # | Що | Коли | Зусилля |
|---|----|------|---------|
| 1 | Push при призначенні з deep link | До пілоту | 0.5 дня (вже є FCM, додати payload) |
| 2 | Auto-reminder через 2 хв (Bull job) | До пілоту | 1 день |
| 3 | Статус курʼєра 🟢🟡🔴 на дашборді | До пілоту | 1 день |
| 4 | Mobile-first responsive дашборд | До пілоту | 2–3 дні |
| 5 | Адмін-панель білінгу + Telegram-алерти засновнику | До першого платного | 3–5 днів |
| 6 | PWA з офлайн-кешем позицій | До першого платного | 2–3 дні |


---

### 17.5 Foreground GPS — фоновий трекінг без участі курʼєра

**Проблема:** iOS та Android можуть обмежувати фонову роботу додатку, що призводить до втрати GPS-пінгів під час активної доставки.

**Рішення: Persistent Foreground Service (стандарт індустрії — Uber, Glovo, Nova Poshta)**

Коли курʼєр починає доставку (`PATCH /deliveries/:id/start`) → додаток запускає **постійне системне сповіщення** у шторці телефону, яке не можна закрити поки доставка активна. Це не push-повідомлення — це foreground service indicator.

```
┌─────────────────────────────────┐
│ @weego · Доставка активна       │
│ Замовлення #142 · вул. Хрещатик │  ← незакривне сповіщення
│ [Відкрити додаток]              │
└─────────────────────────────────┘
```

**Що це дає:**

| Платформа | Механізм | Результат |
|-----------|----------|-----------|
| Android | `foreground service` | OS **не може** вбити процес. GPS гарантовано працює — навіть у режимі економії батареї |
| iOS | `allowsBackgroundLocationUpdates = true` + `UIBackgroundModes: location` | iOS дозволяє фоновий GPS поки є активний location manager |

**Режим економії батареї:** foreground service обходить battery saver на Android. Додаткове блокування роботи при увімкненому режимі економії — **не потрібне** (зайвий код, зайня складність для бізнесу).

Сповіщення зникає автоматично при завершенні доставки (`/complete` або `/fail`).

#### Onboarding курʼєра — запит дозволу на бюджетних Android

Бюджетні телефони (Xiaomi, Samsung, Huawei) мають власні агресивні системи оптимізації батареї, які **можуть** вбивати навіть foreground service. Вирішується **одним кроком** при першому вході курʼєра в додаток:

```
Onboarding Screen (крок 3 з 4):

┌──────────────────────────────────────┐
│  Дозвольте стабільний GPS            │
│                                      │
│  Для точного відстеження доставок    │
│  нам потрібно працювати у фоні       │
│  без обмежень батареї.               │
│                                      │
│  [Відкрити налаштування] → система   │
│  відкриває "Не обмежувати батарею"   │
│  для цього додатку                   │
│                                      │
│  [Пропустити] (знижений GPS-режим)   │
└──────────────────────────────────────┘
```

- Якщо курʼєр дозволив → `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (Android API)
- Якщо пропустив → додаток продовжує роботу, але при першій втраті пінгу > 5 хв нагадує знову
- iOS: аналогічно — запит `Always` location permission з поясненням чому

**Зберігаємо статус у БД:**
```sql
-- у таблиці couriers:
battery_optimization_exempt  BOOLEAN DEFAULT false  -- чи дав курʼєр дозвіл
device_os                    TEXT    -- 'ios' | 'android'
device_brand                 TEXT    -- 'xiaomi' | 'samsung' | 'huawei' | інші
```

Менеджер у дашборді бачить `battery_optimization_exempt = false` як попередження: *"GPS цього курʼєра може бути нестабільним."*

---

### 17.6 iiko Polling — захист від rate limiting (поетапно)

**Проблема:** При масштабуванні до 100+ iiko-закладів polling кожні 30 сек генерує 12 000+ запитів/год — iiko заблокує IP.

**Стратегія: webhook-first, polling як резерв**

iiko підтримує webhooks (вже в архітектурі). Якщо iiko надсилає webhook і при *новому* замовленні — polling стає непотрібним зовсім. Це перевіряємо на перших реальних iiko-клієнтах.

#### Зараз (MVP — до 5 iiko-закладів)

Єдине що реалізуємо зараз: **429 exponential backoff**. Захист від краша, не від масштабу.

```typescript
// IntegrationsModule — iiko polling
async pollIikoOrders(establishment: Establishment) {
  try {
    const orders = await this.iikoClient.getNewOrders(establishment);
    await this.processOrders(orders, establishment);
  } catch (error) {
    if (error.status === 429) {
      // exponential backoff: 1 хв → 5 хв → 15 хв → пропустити цикл
      await this.scheduleRetry(establishment.id, error.retryAfter ?? 60);
      this.logger.warn(`iiko 429 for ${establishment.id}, backoff scheduled`);
    } else {
      this.logger.error(`iiko polling error: ${error.message}`);
      // не кидаємо далі — наступний цикл спробує знову
    }
  }
}
```

#### При 5+ iiko-закладах (тригер для переходу)

**Крок 1:** Перевірити в реальності — чи надсилає iiko webhook при новому замовленні. Якщо **так** → прибрати polling для webhook-capable закладів, залишити тільки як fallback.

**Крок 2:** Якщо polling все ще потрібен → централізований Bull worker:
```
1 Bull repeatable job (кожні 30 сек)
  → Отримує список всіх iiko-закладів
  → Поллить по черзі з затримкою 300ms між запитами
  → При 429 — backoff цього закладу, решта продовжують
```

При 100 закладах: 100 запитів за 30 сек (рівномірно) замість 200 паралельних сплесків.

### ADR-009: iiko Polling — поетапна стратегія

| | |
|-|-|
| **Рішення** | MVP: polling + 429 backoff. При 5+ закладах: webhook-first аудит → централізований worker якщо потрібен. |
| **Обгрунтування** | Невідомо чи iiko надсилає webhook на нове замовлення — перевіряємо на реальних клієнтах. Передчасна оптимізація при 1–4 закладах не виправдана. |
| **Тригер переходу** | 5+ активних iiko-закладів АБО перша 429 помилка в production. |
| **Trade-off** | Ризик rate limiting між 1–4 закладами мінімальний. Backoff handler закриває цей ризик без передчасної архітектурної складності. |

