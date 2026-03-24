# @weego CMI — Audit Findings

> Цей файл ведеться автоматично в процесі серії з 8 аудитів (березень 2026).
> Кожна знахідка містить: опис прогалини, узгоджене рішення, пріоритет.
> Після завершення всіх аудитів — реалізуємо по черзі.

---

## Аудит #1 — API Completeness
**Дата:** 2026-03-24
**Скіл:** `fullstack-dev-skills:spec-miner`
**Результат:** 54 ендпоінти реалізовані, більшість розбіжностей з архдоком — навмисні (state machine замість прямих update/delete, `/me` замість `/:id`).

### 🔴 FINDING-01 — Відсутній механізм створення тенантів і первинних акаунтів

**Прогалина:**
В архітектурному документі був запланований `POST /api/v1/auth/register`, але він не реалізований. Зараз немає жодного способу створити новий заклад і перших користувачів (owner/manager) — ні через API, ні через UI. Система повністю замкнена для нових клієнтів.

**Узгоджене рішення:**
Реалізувати мінімальну **платформ-адмін панель** (окрема сторінка в `apps/web`, захищена `is_platform_admin = true`).

**Флоу створення нового закладу:**
1. Платформ-адмін вводить лише одне поле — **назву закладу** (наприклад: "Піца Рома")
2. Система автоматично генерує:
   - `owner-pica-roma@weego.app` + криптостійкий рандомний пароль
   - `manager-pica-roma@weego.app` + криптостійкий рандомний пароль
   - Slug генерується з назви: пробіли → дефіс, кирилиця → транслітерація, lowercase
3. Після створення — екран з credentials обох акаунтів + кнопки [Скопіювати]
4. Адмін передає credentials клієнту (Telegram/WhatsApp/як зручно)
5. Клієнт може змінити логін і пароль у налаштуваннях в будь-який момент

**Деталі паролів:**
- Мінімум 16 символів
- Обов'язково: великі + малі літери + цифри + спецсимволи
- Генерується через `crypto.randomBytes` (не Math.random)
- Зберігається як bcrypt hash (як всі інші паролі в системі)
- Передається клієнту тільки один раз при створенні (потім лише reset)

**Що потрібно реалізувати:**
- API: `POST /api/v1/admin/establishments` (тільки для `is_platform_admin`)
- API: `GET /api/v1/admin/establishments` — список всіх тенантів
- Web: `/admin` сторінка (список закладів + форма створення)
- Web: екран "Заклад створено" з credentials

**Пріоритет:** 🔴 Критичний — без цього неможливо онбордити жодного клієнта

---

## Аудит #2 — TypeScript
*Заплановано*

## Аудит #3 — Business Logic
**Дата:** 2026-03-24
**Скіл:** `fullstack-dev-skills:code-reviewer`
**Результат:** 9/10 правил PASS. 1 знахідка.

### 🟡 FINDING-02 — Telegram notifications не підключені до production-коду

**Прогалина:**
`NotificationsService.sendTelegram()` реалізований і правильно спроєктований (fire-and-forget), але жодного разу не викликається в production коді. За CLAUDE.md Telegram мав надсилатись у двох випадках:
1. Авто-закриття зміни (cron) → сповіщення менеджеру: "Зміну курʼєра X автоматично закрито"
2. Нагадування курʼєру → паралельно з FCM push

**Де має бути виклик:**
- `src/shifts/shifts.service.ts` → `autoCloseStaleShifts()` — після кожного авто-закриття надіслати Telegram менеджеру закладу
- `src/couriers/couriers.service.ts` → `remind()` — паралельно з FCM (Telegram як резервний канал для курʼєрів без токену)

**Пріоритет:** 🟡 Середній — функціонал не ламає систему, але менеджер не отримує важливих сповіщень про авто-закриті зміни

## Аудит #4 — Security
**Дата:** 2026-03-24
**Скіл:** `/cso` (Chief Security Officer — daily mode, 8/10 confidence gate, all phases)
**Результат:** 0 критичних, 0 high, 2 medium. Загальна security posture — **добра**. Helm, HMAC, bcrypt, rate limiting — все на місці.

### 🟡 FINDING-03 — iiko server_url без allowlist → authenticated SSRF

**Прогалина:**
`UpsertIntegrationDto` приймає `config` як довільний `Record<string, unknown>` без валідації `server_url`. Автентифікований власник тенанта може задати `server_url = "http://169.254.169.254/..."` (AWS IMDS) або адресу внутрішнього сервісу. Cron-завдання iiko-polling зробить реальний HTTP-запит до цієї адреси.

**Де виправити:**
- `apps/api/src/integrations/dto/upsert-integration.dto.ts` — додати `@IsUrl({ protocols: ['https'] })` для `config.server_url` при `type === 'iiko'`
- Або allowlist доменів iiko (`.iiko.it`, `.syrve.online`)

**Пріоритет:** 🟡 Середній — потрібна автентифікація, але ризик реальний на cloud-інфраструктурі

### 🔵 INFO — devDependency CVEs (не production)

**npm audit** показує 6 HIGH CVE, всі в `prisma` CLI (transitive chain через `hono`). Жодного в production залежностях. `npm audit --production` — чисто.

**Рекомендація:** `npm audit fix` для dev-deps. Не блокує реліз.

**Пріоритет:** 🔵 Інформаційний

## Аудит #5 — Design Consistency
**Дата:** 2026-03-24
**Скіл:** `interface-design:audit`
**Результат:** 7 сторінок з violation-ами, 6 — чисті. 1 реальний баг (`--s1`), решта — дрібний drift.

### 🔴 FINDING-04 — CSS-змінна `--s1` використовується але не визначена

**Прогалина:**
`var(--s1)` використовується як фоновий колір у 10 місцях (invite-panel, settings-form, settings/page, integrations-manager, webhooks-manager), але в `globals.css` ця змінна **не визначена**. Замість неї — `--sf` (zinc-900, cards/panels). Елементи з `var(--s1)` рендеряться без фону (прозорі або успадковані).

**Де виправити:**
Додати в `globals.css` аліас `--s1: var(--sf);` або замінити `--s1` → `--sf` у всіх 10 файлах.

**Файли:**
- `apps/web/src/app/(dashboard)/couriers/invite-panel.tsx` (lines 23, 116, 224)
- `apps/web/src/app/(dashboard)/settings/settings-form.tsx` (line 83)
- `apps/web/src/app/(dashboard)/settings/page.tsx` (line 14)
- `apps/web/src/app/(dashboard)/integrations/integrations-manager.tsx` (lines 146, 158, 190)
- `apps/web/src/app/(dashboard)/webhooks/webhooks-manager.tsx` (lines 80, 97)

**Пріоритет:** 🔴 Критичний — візуальний баг, елементи без фону

---

### 🟡 FINDING-05 — Design system drift: hardcoded hex замість CSS-змінних

**Прогалина:**
Частина компонентів використовує hardcoded hex-значення замість CSS-змінних. Це не ламає UI прямо зараз (значення правильні), але при зміні теми або дизайн-токенів — не оновиться.

**Паттерни:**
| Hardcoded | Має бути | Файли |
|-----------|----------|-------|
| `#6aaa84` | `var(--acm)` | invite-panel.tsx:135, settings-form.tsx:169, webhooks-manager.tsx:54,136, integrations-manager.tsx:211 |
| `#09090b` | `var(--bg)` | orders-table.tsx:135,201, invite-panel.tsx:135, login/page.tsx:90 |

**Додатково — inconsistency:**
- Інлайн `fontFamily: 'var(--font-mono)'` в page.tsx замість класу `.mono` (використовується скрізь в інших файлах)
- Інлайн `boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)'` в page.tsx, invite-panel.tsx, settings-form.tsx замість класу `.card-shine`
- `borderRadius: '4px'` на кнопках замість 6px — invite-panel.tsx:224,233, webhooks-manager.tsx:116,206,220, integrations-manager.tsx:148,224

**Пріоритет:** 🟡 Середній — не ламає UI, але утруднює підтримку

---

**Що PASS:**
✅ Всі таблиці — правильний формат заголовків (UPPERCASE, 11px, tracking-[0.05em], --t4)
✅ Всі картки — `rounded-lg` ≤ 8px (без `rounded-2xl`, `rounded-3xl`)
✅ Всі числові дані (analytics, couriers-list) — клас `.mono`
✅ Семантичні кольори (ok/bad/warning) — тільки для статусів курʼєрів, не на кнопках
✅ Sage accent — тільки на кнопках, не змішано зі статус-кольорами

## Аудит #6 — API ↔ Mobile Contract
**Дата:** 2026-03-24
**Скіл:** `fullstack-dev-skills:spec-miner`
**Результат:** 12 ендпоінтів перевірено. 1 критичний баг, 1 missing field, 1 type mismatch.

### 🔴 FINDING-06 — `PATCH /deliveries/:id/start` повертає неповний об'єкт → crash у мобільному

**Прогалина:**
`ProofOfDeliveryService.startDelivery()` повертає `{ status: 'in_progress', started_at: Date }` — лише 2 поля. Мобільний додаток очікує повний `ActiveDelivery` об'єкт і відразу рендерить `InProgressState` з `delivery.order.address`. Оскільки `order` в отриманому об'єкті відсутній — React Native крашиться або показує порожній екран до наступного polling (10 секунд).

```typescript
// apps/mobile/app/(app)/index.tsx:223
const updated = await apiPatch<ActiveDelivery>(`/api/v1/deliveries/${delivery.id}/start`);
setDelivery(updated); // ← updated = { status, started_at } — без order!

// Потім рендерить:
{delivery.order.address}  // ← crash: cannot read 'address' of undefined
```

**Де виправити:**
- Варіант A (краще): `startDelivery()` повертає повний об'єкт — додати `include: { order: { select: ... } }` як у `getActiveDelivery()`
- Варіант B: мобільний після успішного `accept` викликає `fetchState()` замість `setDelivery(updated)`

**Файл:** `apps/api/src/proof-of-delivery/proof-of-delivery.service.ts:106`

**Пріоритет:** 🔴 Критичний — крашить при першому прийнятті доставки

---

### 🟡 FINDING-07 — `GET /deliveries/active` не повертає `order.notes`

**Прогалина:**
`getActiveDelivery()` у select-запиті не включає поле `notes` з таблиці `orders`. Мобільний додаток відображає `delivery.order.notes` у картці доставки, але завжди отримує `undefined`.

```typescript
// API select (proof-of-delivery.service.ts:55):
select: { id: true, address: true, lat: true, lng: true, status: true, external_id: true }
// ← notes відсутній!

// Mobile (index.tsx:400):
{delivery.order.notes ? <Text>{delivery.order.notes}</Text> : null}
// ← завжди null, навіть якщо є нотатка
```

**Де виправити:** Додати `notes: true` до select у `getActiveDelivery()`.

**Пріоритет:** 🟡 Середній — менеджер бачить нотатки замовлення, а курʼєр — ні

---

### 🔵 INFO — Type drift: `total_distance_km` і `ProofPayload`

**total_distance_km:** Prisma серіалізує `Decimal` як рядок у JSON. Мобільний тип: `string` ✓. Веб тип: `number | null` ✗. Веб-код не використовує це поле безпосередньо (лише analytics), тому практичного впливу немає.

**ProofPayload interface** (mobile): відсутній `captured_at` у типі, але він коректно передається у реальному виклику `proof.tsx:119`. Невідповідність тільки в інтерфейсі, не в рантаймі.

**Пріоритет:** 🔵 Інформаційний

---

**Що PASS (10 з 12 контрактів):**
✅ Auth login/refresh/logout — формат відповіді збігається
✅ Shift start/end/my — shape відповідає mobile types
✅ Onboarding accept-invite — `{ access_token, refresh_token, user }` ✓
✅ Tracking ping — `{ lat, lng, battery }` ✓
✅ Upload URL — `{ upload_url, photo_key }` ✓
✅ Refresh token flow — mobile надсилає Cookie header, API читає через cookie-parser ✓
✅ Device token PATCH — `{ device_token, device_platform }` ✓

## Аудит #7 — Database
**Дата:** 2026-03-24
**Скіл:** `fullstack-dev-skills:postgres-pro`
**Результат:** Схема в цілому якісна. 1 критичний баг (зламаний GPS), 2 відсутні composite indexes.

### 🔴 FINDING-08 — GPS ping endpoint зламаний: `courier_id` не надсилається з мобільного

**Прогалина:**
`PingDto` вимагає `courier_id: string` у тілі запиту (`@IsString() @IsNotEmpty()`). Але мобільний додаток надсилає тільки `{ lat, lng, battery }` — без `courier_id`. Кожен GPS-пінг з мобільного завершується `400 Bad Request` → GPS-трекінг повністю не працює в production.

```typescript
// apps/api/src/tracking/dto/ping.dto.ts — вимагає courier_id у body
export class PingDto {
  @IsString()
  @IsNotEmpty()
  courier_id: string; // ← required, but mobile never sends this!
  ...
}

// apps/mobile/src/services/location.ts — надсилає без courier_id
body: JSON.stringify({ lat, lng, battery }), // ← no courier_id
```

Додатково — це design issue: `courier_id` повинен читатися з JWT (`user.courier_id`), а не з body. Інакше будь-який авторизований курʼєр може надсилати пінги від імені іншого курʼєра (підміна courier_id).

**Рішення:**
1. Видалити `courier_id` з `PingDto` (мобільний не змінюємо — він вже правильний)
2. У `handlePing()`: замінити `dto.courier_id` на `user.courier_id` (з JWT)
3. Guard: перевіряти `user.courier_id` існує, інакше 403

**Файли:**
- `apps/api/src/tracking/dto/ping.dto.ts`
- `apps/api/src/tracking/tracking.service.ts`

**Пріоритет:** 🔴 Критичний — GPS-трекінг не працює з дня першого

---

### 🟡 FINDING-09 — Відсутній composite index `(courier_id, status)` на `deliveries`

**Прогалина:**
`getActiveDelivery()` (hot path — кожні 10 секунд з кожного активного мобільного) виконує:
```sql
WHERE courier_id = ? AND status IN ('assigned', 'in_progress')
```
Є окремі `@@index([courier_id])` і `@@index([status])`. PostgreSQL вибере один з них і відфільтрує по другому. Composite index `(courier_id, status)` дозволить Index Scan по обох умовах одразу.

```prisma
// apps/api/prisma/schema.prisma — Delivery model
@@index([courier_id])          // існує
@@index([status])              // існує
// @@index([courier_id, status])  ← ВІДСУТНІЙ
```

**Рішення:** Додати `@@index([courier_id, status])` до моделі `Delivery`.

**Пріоритет:** 🟡 Середній — помітне при > 50 активних курʼєрах

---

### 🟡 FINDING-10 — Відсутній composite index `(courier_id, created_at)` на `location_pings`

**Прогалина:**
Таблиця `location_pings` — найбільша в системі (пінг кожні 15с × всі курʼєри). Є окремі `@@index([courier_id])` і `@@index([created_at])`. Але три критичні запити потребують composite:

1. **Dashboard** (`couriers.service.ts:49`) — `DISTINCT ON (courier_id) ... ORDER BY courier_id, created_at DESC` — без composite читає всі пінги per courier
2. **Retention delete** (`retention.service.ts:104`) — `WHERE courier_id IN (...) AND created_at < cutoff` — видалення мільйонів рядків
3. **Shifts cron** (`shifts.service.ts:170`) — `NOT EXISTS (... WHERE courier_id = ? AND created_at > cutoff)` — correlated subquery

```prisma
// apps/api/prisma/schema.prisma — LocationPing model
@@index([courier_id])          // існує
@@index([created_at])          // існує
// @@index([courier_id, created_at])  ← ВІДСУТНІЙ
```

**Рішення:** Додати `@@index([courier_id, created_at])`.
Примітка: Для `DISTINCT ON` з `ORDER BY courier_id, created_at DESC` — потрібен index з DESC на created_at (у Prisma: `@@index([courier_id, created_at(sort: Desc)])`).

**Пріоритет:** 🟡 Середній — критично при > 1 тижні роботи (накопичення пінгів)

---

**🔵 INFO — Неправильний коментар в analytics.service.ts:**
Рядок 17: `"Filtered on (establishment_id, created_at) — covered by existing composite index"` — такого composite index немає. Є `@@index([establishment_id, status])`, але не `(establishment_id, created_at)`. Аналітика працює через `@@index([establishment_id])` + фільтр по created_at. При великих обсягах даних варто додати `@@index([establishment_id, created_at])`.

---

**Що PASS (все інше):**
✅ Prisma schema — 14 моделей, всі UUID PK, всі enums задекларовані
✅ Multi-tenant: `establishment_id` або CASCADE через FK на всіх таблицях
✅ `delivery_proofs` — немає FK onDelete Cascade → захист від випадкового видалення ✓
✅ PostGIS: `ST_MakePoint`/`ST_SetSRID`/`ST_DWithin` — коректне використання через `$queryRaw`/`$executeRaw`
✅ N+1 queries — не виявлено. Всі `findMany` використовують `include`/batch, не loop+fetch
✅ JSONB `settings`/`config`/`geo_flags` — тільки read/write, без containment queries → GIN не потрібен
✅ `UNIQUE([external_id, establishment_id])` на orders → idempotency POS замовлень ✓
✅ Retention: `DELETE` з `$executeRaw` — ефективний bulk delete (не ORM loop)

## Аудит #8 — Dead Code / TODO
**Дата:** 2026-03-24
**Скіл:** `fullstack-dev-skills:code-reviewer`
**Результат:** Кодова база чиста. TODO/FIXME відсутні. Знайдено 1 medium issue, 4 minor / info.

### 🟡 FINDING-11 — Дублюючий endpoint реєстрації device token з несумісним DTO

**Прогалина:**
Існують два ендпоінти для device token, але з різними назвами полів:

```
PATCH /api/v1/couriers/me/device-token   → UpdateDeviceTokenDto { device_token, device_platform, device_brand? }
POST  /api/v1/couriers/:id/device-token  → RegisterDeviceTokenDto { token, platform, brand }  ← старий
```

Мобільний додаток використовує тільки `PATCH /me/device-token`. Другий ендпоінт (`POST /:id/device-token`) не викликається ніким (ні web, ні mobile). Два різних DTO для однієї дії — плутанина і ризик помилки при майбутній підтримці.

**Файли:**
- `apps/api/src/couriers/dto/register-device-token.dto.ts`
- `apps/api/src/couriers/couriers.controller.ts:77-84`

**Рішення:** Видалити `POST /:id/device-token` ендпоінт і `RegisterDeviceTokenDto`.

**Пріоритет:** 🟡 Середній — мертвий код + плутанина при підтримці

---

### 🔵 INFO — Мертві інтерфейси в мобільному `types/index.ts`

```typescript
// Ніколи не імпортуються поза types/index.ts:
export interface PingPayload { lat: number; lng: number; battery: number | null; }
export interface ProofPayload { lat: number; lng: number; accuracy: number; photo_key?: string; }
```

Обидва інтерфейси не використовуються — фактичні виклики в `location.ts` і `proof.tsx` побудовані inline. Додатково `ActiveDelivery` імпортується в `proof.tsx:30` але не використовується як тип.

**Пріоритет:** 🔵 Інформаційний

---

### 🔵 INFO — `JwtPayload` vs `AuthenticatedUser` в shifts модулі

`shifts.service.ts` і `shifts.controller.ts` використовують `JwtPayload` (з полем `sub`) замість `AuthenticatedUser` (з полем `id`). Всі інші модулі використовують `AuthenticatedUser`. Не є функціональним багом (shifts service ніколи не звертається до `.id`/`.sub`), але є типовою непослідовністю.

**Пріоритет:** 🔵 Інформаційний

---

### 🔵 INFO — `console.warn` в `location.ts` background task

```typescript
// apps/mobile/src/services/location.ts:24
console.warn('[location-task] error:', error.message);
```

Єдине місце `console.*` в усьому проєкті. В background task (TaskManager) NestJS Logger недоступний, тому `console.warn` тут виправданий. Але варто позначити для майбутнього рефакторингу.

**Пріоритет:** 🔵 Інформаційний

---

### 🔵 INFO — `auto_dispatch` і `delivery_sla_minutes` в CLAUDE.md, але відсутні в Prisma schema

CLAUDE.md архітектурна секція описує ці поля в `establishments`, але вони не реалізовані. Не є багом — задокументована майбутня фіча. Варто прибрати з CLAUDE.md поки не реалізовано.

**Пріоритет:** 🔵 Інформаційний (документаційна невідповідність)

---

**Що PASS (все критичне чисто):**
✅ TODO / FIXME / HACK / XXX — відсутні в усьому проєкті
✅ `console.log` у API — відсутній, NestJS Logger скрізь
✅ `@ts-ignore` / `@ts-expect-error` — відсутні
✅ Hardcoded secrets — відсутні
✅ Stub / not-implemented placeholders — відсутні
✅ Magic numbers — всі задекларовані як named constants
✅ `eslint-disable` у web — тільки для Leaflet (немає TS типів) і react-hooks (виправдано)

---

## Підсумок після всіх аудитів
*Буде заповнено після аудиту #8*
