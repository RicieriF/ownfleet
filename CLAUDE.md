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
| Geocoding | Nominatim (OpenStreetMap) + Redis кеш (TTL 30 днів) + Bull черга (rate limit 1 req/s) |
| File Storage | Cloudflare R2 (S3-сумісний, presigned URLs) |
| Push | Firebase FCM |
| Notifications | Telegram Bot (fire-and-forget, side-channel) |
| Auth | JWT (access 15хв) + Refresh tokens (30 днів, HttpOnly cookie) |

---

## Архітектурний патерн

**Modular Monolith** — один NestJS застосунок, чіткі межі між модулями (bounded contexts). Модулі НЕ імпортують один одного напряму — тільки через сервіси або події.

**Multi-tenancy:** `establishment_id` присутній у кожній таблиці. JWT payload містить `{ sub: userId, establishment_id, role }`. Middleware перевіряє ізоляцію тенанта на кожному запиті.

**Виняток:** `tracking_tokens` — навмисно без `establishment_id`. Доступ тільки через непередбачуваний UUID token (122 bits entropy). Токен сам є ключем ізоляції — не можна запитати дані іншого замовлення не маючи його токена.

**API versioning:** всі endpoints — `/api/v1/` prefix.

---

## Модулі (NestJS)

| Модуль | Відповідальність |
|--------|-----------------|
| `AuthModule` | JWT login/refresh/logout, tenant isolation |
| `EstablishmentsModule` | CRUD закладів, settings, PlanAccessGuard |
| `CouriersModule` | Управління курʼєрами, FCM tokens |
| `ShiftsModule` | Зміни курʼєрів: старт/завершення, авто-закриття, Telegram-нагадування (shift_ending_soon, courier_not_responding) |
| `OrdersModule` | Замовлення, state machine, призначення курʼєра + розрахунок ETA при assign; dispatch алгоритм (manual/recommend/auto): `POST /ready`, `POST /assign-recommended`, `POST /reassign`; `GET /couriers/workload-today` |
| `TrackingModule` | GPS пінги → Redis → WebSocket → дашборд; fire-and-forget виклик EtaService для детекції виїзду |
| `ProofOfDeliveryModule` | Гео-пруф (обовʼязк.) + фото (опц.), 300м перевірка; `GET /deliveries/:id/proof` — перегляд пруфу менеджером (geo_flags, фото, точність GPS) |
| `RetentionModule` | Cron: очищення orders + location_pings + tracking_tokens (де expires_at < NOW()); авто-закриття змін; shift_ending_soon; courier_not_responding; eta-overdue-alert; shift-anomaly-check; recommend-timeout-check; weekly S3 backup delivery_proofs (9 cron jobs) |
| `EtaModule` | Розрахунок ETA через OSRM, детекція виїзду курʼєра (100м), cron-алерти про запізнення |
| `GeocodingModule` | Геокодування адрес через Nominatim; Redis кеш TTL 30 днів; Bull queue rate limit 1 req/s; якщо координати вже є в payload — Nominatim не викликається; timeout 2с — замовлення зберігається без блокування; після успішного geocoding: `redis.publish('geocoding:done', ...)` → PublicTrackingModule емітить `order:coords_ready` |
| `IntegrationsModule` | Poster POS webhook + iiko polling; при отриманні замовлення без координат → виклик `GeocodingService` |
| `WebhooksModule` | Outbound webhooks з HMAC, Bull retry queue |
| `NotificationsModule` | FCM push + Telegram (завжди fire-and-forget) |
| `OnboardingModule` | Invite tokens для курʼєрів, onboarding статус, збереження transport_mode |
| `AnalyticsModule` | Статистика доставок та ефективності |
| `ApiKeysModule` | API ключі для закладів (customer tracking widget); HMAC-SHA256 key_hash; `is_active` для soft-disable; `allowed_domains` + auto-www; `last_used_domain` аудит; `ApiKeyGuard` з throttle унікальних external_id |
| `PublicTrackingModule` | Публічні endpoints без auth для customer tracking widget; `ApiKeyGuard`; окремий WS namespace `/public`; кімнати `order:{order_id}:public`; snapshot всіх 6 станів; hosted tracking + `/t/[token]` redirect |
| `MetricsModule` | Prometheus метрики: `http_request_duration_seconds` (через MetricsInterceptor), `bull_queue_depth` (5 черг: ping, webhook, dispatch, geocoding, tracking_disconnect; cron кожні 30с); Node.js default metrics; `GET /metrics` захищений Bearer `METRICS_SECRET` |

---

## Схема БД (скорочено)

```sql
establishments  (id, name, plan, trial_ends_at, paid_until, onboarding_status, settings JSONB,
                 -- settings JSONB keys: retention_orders_days, retention_pings_days,
                 --   courier_not_responding_min, show_sla_on_dashboard,
                 --   eta_alert_enabled, eta_alert_delay_minutes,
                 --   dispatch_recommend_radius_km, dispatch_anomaly_threshold_minutes,
                 --   dispatch_anomaly_min_deliveries, dispatch_no_courier_escalation_minutes,
                 --   dispatch_recommend_timeout_minutes (null = вимкнено)
                 timezone TEXT NOT NULL DEFAULT 'Europe/Kyiv',  -- IANA; CHECK constraint; sync ALLOWED_TIMEZONES↔TIMEZONE_OPTIONS
                 dispatch_mode dispatch_mode NOT NULL DEFAULT 'manual',  -- enum: manual|recommend|auto
                 delivery_sla_minutes INT NULL, lat FLOAT NULL, lng FLOAT NULL,
                 hosted_tracking_enabled BOOLEAN NOT NULL DEFAULT FALSE)
                -- hosted_tracking_enabled: тільки super admin. Коли FALSE — кнопка "Копіювати посилання
                -- клієнту" і фраза про hosted page в /settings приховані; embed-код і ключ доступні.
users           (id, establishment_id, role CHECK IN ('owner','manager','dispatcher'), email, password_hash, courier_id UNIQUE, is_platform_admin,
                 telegram_chat_id TEXT UNIQUE NULL, telegram_prefs JSONB DEFAULT '{}')
couriers        (id, establishment_id, name, phone, device_token, device_platform DevicePlatform NULL, active,
                 transport_mode TransportMode NULL,   -- car|moto_gas|moto_electric|bicycle|walking
                 battery_optimization_exempt BOOLEAN DEFAULT FALSE,
                 device_brand TEXT NULL, telegram_chat_id TEXT UNIQUE NULL, telegram_prefs JSONB DEFAULT '{}',
                 last_reminder_sent_at TIMESTAMPTZ NULL, reminder_count INT DEFAULT 0)
shifts          (id, courier_id, establishment_id, started_at, ended_at TIMESTAMPTZ NULL,
                 ended_by CHECK IN ('courier','manager','auto'), planned_end_at,
                 total_deliveries, total_distance_km, anomaly_alerted_at)
                -- ended_at IS NULL = зміна активна; anomaly_alerted_at — захист від повторних алертів
orders          (id, establishment_id, external_id, address, lat, lng, status, source, created_at,
                 ready_at TIMESTAMPTZ NULL)   -- ready_at: встановлює POST /ready; dispatch idempotency key
                UNIQUE(external_id, establishment_id)
deliveries      (id, order_id, courier_id, status, assigned_at, started_at, completed_at,
                 proof_id, eta_seconds INT NULL, eta_started_at TIMESTAMPTZ NULL,
                 eta_overdue_alerted_at TIMESTAMPTZ NULL)
delivery_proofs (id, delivery_id, lat, lng, captured_at, order_closed_at, photo_key,
                 geo_match, accuracy, geo_flags JSONB)  -- НІКОЛИ не видаляється
location_pings  (id, courier_id, location GEOMETRY(Point,4326), battery, created_at)
integrations    (id, establishment_id, type, config JSONB, active)
webhooks        (id, establishment_id, url, secret, events TEXT[], active, consecutive_failures, last_error_at, last_error TEXT NULL)
invite_tokens   (id, establishment_id, token, courier_id, expires_at, used_at)
retention_logs  (id, establishment_id, deleted_orders, deleted_pings,
                 deleted_order_ids JSONB DEFAULT '[]',  -- [{id, external_id}] для аудиту
                 run_at)
tracking_tokens (id, order_id UNIQUE, token UNIQUE, expires_at, created_at)
                -- НЕ має establishment_id — навмисний виняток: ізоляція через 122-bit UUID token
                -- expires_at = created_at + 4h; RetentionModule прибирає прострочені
api_keys        (id, establishment_id, key_hash, key_prefix, name, is_active, allowed_domains TEXT[], last_used_domain)
                -- Origin-based domain check: non-browser clients можуть spoofити — прийнятний trade-off
                -- порожній allowed_domains = заблоковано; key_prefix для lookup без повного скану
refresh_tokens  (id, user_id, token_hash UNIQUE, expires_at, created_at)
                -- Persistent refresh token storage; onDelete Cascade від users
billing_events  (id, establishment_id, type BillingEventType, created_at, metadata JSONB)
                -- Аудит білінгових подій: trial_started|trial_expired|payment_received|plan_changed|grace_period_started|access_revoked
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

**Shifts:**
```
active (ended_at IS NULL) → ended (ended_at SET, ended_by = courier|manager|auto)
```
- Курʼєр може мати тільки одну активну зміну одночасно
- `POST /api/v1/shifts/start` — курʼєр ініціює (тільки з мобільного додатку)
- `POST /api/v1/shifts/end` — курʼєр або менеджер завершує
- Cron кожні 30 хв: авто-закриття змін > 16 годин без GPS-пінгу (`ended_by = 'auto'`)
- Курʼєр може отримувати доставки ТІЛЬКИ якщо є активна зміна

Переходи тільки через явні методи state machine. Жодних прямих `UPDATE SET status=...` в обхід guards.

---

## Система змін (Shifts) — бізнес-логіка

**Термінологія:** "На зміні" ≠ "онлайн". "Онлайн" — технічний стан GPS, **ніколи не показується** в UI менеджера.

**Обмеження:**
- Курʼєр НЕ може отримати доставку без активної зміни (`ShiftActiveGuard`)
- Одна активна зміна на курʼєра одночасно (`UNIQUE` на `courier_id` де `ended_at IS NULL`)
- Persistent notification у мобільному — тільки під час активної **доставки** (не зміни)

**Дашборд KPI:**
- `X/N На зміні` (не "онлайн"); підпис: `X в дорозі · Y вільних · Z не вийшли`
- "Не вийшли" = активні курʼєри без поточної зміни; кнопка [Нагадати] → Telegram push

---

## Правила коду

- **TypeScript strict mode** — ніяких `any`, ніяких `@ts-ignore`
- **DTO + Class-validator** — валідація на ВСІХ ендпоінтах (body, query, params) через NestJS pipes
- **Prisma** — всі DB запити через Prisma. Raw SQL тільки для PostGIS (`ST_DWithin`, `ST_MakePoint`)
- **Fire-and-forget** — Telegram і FCM ніколи не блокують відповідь. Завжди `void` без `await` або через `setImmediate`
- **Bull** — всі retry-черги через Bull, не in-memory
- **Idempotency** — `INSERT ... ON CONFLICT (external_id, establishment_id) DO NOTHING` для POS замовлень
- Жодних `console.log` — тільки NestJS `Logger`
- **Timezone** — час у Telegram-повідомленнях завжди форматується з `establishment.timezone` (IANA). Список дозволених зон: `ALLOWED_TIMEZONES` в `establishments/dto/update-settings.dto.ts`. Фронтенд-константа `TIMEZONE_OPTIONS` в `settings-form.tsx` має залишатись синхронізованою з нею.

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

**НЕ застосовується на:** `/health`, `/metrics`, `/api/v1/auth/*`, `/api/v1/onboarding/accept-invite/:token`, `/api/v1/public/*`

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

Веб-клієнт перед підключенням отримує short-lived ws-token (60с):
`GET /api/v1/auth/ws-token` (cookie-auth, JwtAuthGuard) → `{ token: string }`

Клієнт: `io(WS_URL, { auth: (cb) => fetchWsToken().then(token => cb({ token })) })`
Сервер: `handleConnection()` перевіряє JWT → `socket.join('est:' + establishment_id)`
Неавторизовані — відхиляються негайно. Менеджер отримує тільки події свого закладу.

Мобільний додаток використовує `x-refresh-token` header замість cookie.
`access_token` cookie — httpOnly (JS не може читати). Refresh через `/api/v1/auth/refresh`.

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
- При старті доставки (`in_progress`) → показувати **persistent notification** у шторці (незакривне, тримає GPS живим)
- При активній зміні без доставки → notification НЕ показується (курʼєр відпочиває)
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

## Що НЕ чіпати без обговорення

- `apps/api/prisma/migrations/` — тільки через `prisma migrate dev`. Якщо міграція містить `CREATE INDEX CONCURRENTLY` або інші команди, що не підтримуються в транзакції shadow DB — використовувати ручний флоу: створити директорію вручну, написати SQL, застосувати через `npx prisma db execute --file ...`, зареєструвати через `npx prisma migrate resolve --applied <name>`. НЕ запускати `prisma db pull` — він перезаписує schema.prisma.
- State machine transitions в `OrdersModule` та `ProofOfDeliveryModule`
- `PlanAccessGuard` логіка — зміна може зламати білінг
- `delivery_proofs` retention — ця таблиця захищена навмисно
- WebSocket room naming: `est:{establishment_id}` — зміна зламає multi-tenant ізоляцію
- Публічний WS namespace `/public` використовує кімнати `order:{order_id}:public` — окремий простір імен, не плутати з менеджерськими кімнатами

---

## Environment Variables (обовʼязкові)

```
DATABASE_URL         postgresql://...?connection_limit=20&pool_timeout=10
REDIS_URL            redis://...
JWT_ACCESS_SECRET    (rotate 90 days)
JWT_REFRESH_SECRET   (rotate 180 days)
FIREBASE_SERVICE_ACCOUNT_JSON
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET  (required when bot is active — webhook rejects all requests if unset)
S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY / S3_BUCKET
BACKUP_S3_ENDPOINT / BACKUP_S3_ACCESS_KEY / BACKUP_S3_SECRET_KEY / BACKUP_S3_BUCKET
                     (weekly delivery_proofs backup; gracefully skipped if unset)
WEBHOOK_HMAC_SECRET  (per-establishment, stored in DB)
OSRM_URL             (optional; default: https://router.project-osrm.org)
OSRM_URL_DRIVING / OSRM_URL_CYCLING / OSRM_URL_FOOT
                     (optional per-profile overrides; fallback to OSRM_URL if unset)
API_KEY_SECRET       (HMAC-SHA256 key for API key hashing; rotate 90 days — app crashes on startup if unset)
NEXT_PUBLIC_APP_URL  (web app public URL, e.g. https://weego.app; used in tracker.js base URL fallback and embed code generation in /settings)
METRICS_SECRET       (Bearer token protecting GET /metrics; required in prod — if unset, /metrics is open. Must match Alloy config. Not loaded by the app on startup, but Alloy scrape will fail with 401 if mismatched.)
```

### Grafana Cloud (Alloy sidecar — `infra/grafana-alloy/`)

```
GRAFANA_CLOUD_PROMETHEUS_URL   (Grafana Cloud → My Account → Prometheus → Remote Write Endpoint)
GRAFANA_CLOUD_PROMETHEUS_USER  (numeric Prometheus user ID from Grafana Cloud)
GRAFANA_CLOUD_API_KEY          (Grafana Cloud API key with MetricsPublisher role)
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

---

## Design System

Always read `DESIGN.md` before making any visual or UI decisions for `apps/web` or `apps/mobile`.

All font choices, colors, spacing, border-radius, and aesthetic direction are defined there. Do not deviate without explicit user approval.

Key decisions to remember:
- **Dark-first** — background `#0c0b09` (warm near-black), surface `#1a1917` (warm surface). Do NOT switch to a light dashboard.
  - **Виняток: `/embed/track/[token]`** — публічна сторінка трекінгу для клієнтів закладу використовує **світлу тему** (білий фон, нейтральні кольори). Причина: embed відображається всередині iframe на сайтах ресторанів (здебільшого світлі), його бачать клієнти, а не менеджери. Це єдиний виняток із dark-first правила в усьому продукті.
- **Manrope** — primary font for all UI text (web + mobile). Import from Google Fonts. NOT Onest, Inter, or Roboto.
- **JetBrains Mono** — for all numerical data, timestamps, IDs, coordinates, battery %, order counts.
- **No accent color** — interactive states use neutral elevation (`--surface-3` `#3a3935` bg + `--text-1` text). No sage, no blue, no indigo, no violet. Only semantic signals: green/amber/red for status dots and alert borders.
- **Semantic-only status colors** — green/amber/red ONLY for courier status dots and system alerts, never for buttons or nav.
- **Compact density** — operational tool, not a marketing page. Table rows `py-2.5 px-3`.
- **Border-radius ≤ 8px** — no `rounded-2xl` or `rounded-3xl` on cards. Buttons: 6px.
- **Card depth** — `inset 0 1px 0 rgba(255,255,255,0.05)` top-edge shine, no box-shadow outlines.
- **Focus ring** — double-ring: `0 0 0 1px var(--bg), 0 0 0 2px rgba(250,249,246,0.25)`. Neutral warm, no chromatic accent.
- **Table headers** — always UPPERCASE, 11px/600/+0.05em tracking, `--text-4` color.
- **Text contrast rule** — `--text-3` (#9c9b96, 5.6:1 WCAG AA) for ALL readable body text: hint text, descriptions, option labels, helper text, input units. `--text-4` (#78776e, 3.5:1 — below WCAG AA) ONLY for: uppercase structural section/table headers, timestamps in table cells, disabled states, transient states ("Збереження…"). Never use `--text-4` for text the user must read to make a decision.
- **Dashboard is info-first** — main `/` dashboard shows KPIs, alerts (AlertCard component), pending assignments, active deliveries table, CourierStatusPanel (300px sidebar). Two-column layout. No map on the main page.
- **`/history` page** — completed/failed/cancelled orders with status tabs (all/completed/failed/cancelled) and date range filters (today/7d/30d). Includes proof drawer (`proof-drawer.tsx`) that shows geo verification, anomaly flags, GPS accuracy and delivery photos for each completed order.
- **`/shifts` page** — active shifts table with real-time WS updates (`shift:started`/`shift:ended`), inline planned_end editing, force-end button; "Not started" section with Remind button. Real-time via WebSocket.
- **Map is a separate `/map` page** — full-screen Leaflet map with right-side courier panel. Real routing via OSRM (free, no API key). Real ETA in minutes per transport mode.
- **Map stack:** Leaflet.js v1.9 + CartoDB Dark Matter tiles. No Mapbox, no Google Maps.
- **Courier markers:** Circle with initials only (no transport badge). Pulse animation on 🔴 danger (1.4s, red glow) and 🟡 background (3.5s, amber glow). 🟢 online is static — pulsing "all good" is noise.
- **Routes hidden by default** — shown only for selected courier (OSRM real road geometry, animated dashed line).

In QA or review mode: flag any code that deviates from DESIGN.md without an explicit reason.
