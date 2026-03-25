# @weego CMI — Audit Findings

> Цей файл ведеться автоматично в процесі серії з 8 аудитів (березень 2026).
> Кожна знахідка містить: опис прогалини, узгоджене рішення, пріоритет.
> Після завершення всіх аудитів — реалізуємо по черзі.

---

## Аудит #1 — API Completeness
**Дата:** 2026-03-24
**Скіл:** `fullstack-dev-skills:spec-miner`
**Результат:** 54 ендпоінти реалізовані, більшість розбіжностей з архдоком — навмисні (state machine замість прямих update/delete, `/me` замість `/:id`).

### ✅ FINDING-01 — Відсутній механізм створення тенантів і первинних акаунтів

**Статус:** Закрито — реалізовано повністю.

**Реалізовано:**
- `apps/api/src/platform/` — `PlatformModule` з `POST /api/v1/platform/establishments`, `GET /api/v1/platform/establishments`, `PATCH /api/v1/platform/establishments/:id/subscription`
- `apps/web/src/app/platform/` — адмін-панель (`page.tsx`, `platform-panel.tsx`, `layout.tsx`)
- `PlatformAdminGuard` — захист через `is_platform_admin`

---

## Аудит #2 — TypeScript
*Заплановано*

## Аудит #3 — Business Logic
**Дата:** 2026-03-24
**Скіл:** `fullstack-dev-skills:code-reviewer`
**Результат:** 9/10 правил PASS. 1 знахідка.

### ✅ FINDING-02 — Telegram notifications не підключені до production-коду

**Статус:** Закрито — реалізовано повний TelegramModule з усіма сповіщеннями:
- `autoCloseStaleShifts()` → Telegram менеджеру
- `checkShiftEndingSoon()` → Telegram курʼєру (з таймзоною закладу)
- `checkCourierNotResponding()` → Telegram менеджеру
- Reconnect flow (відʼєднання/підʼєднання бота)

## Аудит #4 — Security
**Дата:** 2026-03-24
**Скіл:** `/cso` (Chief Security Officer — daily mode, 8/10 confidence gate, all phases)
**Результат:** 0 критичних, 0 high, 2 medium. Загальна security posture — **добра**. Helm, HMAC, bcrypt, rate limiting — все на місці.

### ✅ FINDING-03 — iiko server_url без allowlist → authenticated SSRF

**Статус:** Закрито — `@IsUrl({ protocols: ['https'], require_tld: true })` додано до `upsert-integration.dto.ts`.

### 🔵 INFO — devDependency CVEs (не production)

**npm audit** показує 6 HIGH CVE, всі в `prisma` CLI (transitive chain через `hono`). Жодного в production залежностях. `npm audit --production` — чисто.

**Рекомендація:** `npm audit fix` для dev-deps. Не блокує реліз.

**Пріоритет:** 🔵 Інформаційний

## Аудит #5 — Design Consistency
**Дата:** 2026-03-24
**Скіл:** `interface-design:audit`
**Результат:** 7 сторінок з violation-ами, 6 — чисті. 1 реальний баг (`--s1`), решта — дрібний drift.

### ✅ FINDING-04 — CSS-змінна `--s1` використовується але не визначена

**Статус:** Закрито — `--s1: #18181b` додано в `globals.css` як аліас для `--sf`.

---

### ✅ FINDING-05 — Design system drift: hardcoded hex замість CSS-змінних

**Статус:** Закрито — жодного `#6aaa84` чи `#09090b` хардкодом у `.tsx` файлах не залишилось.

---

### (архів оригінального опису)
### 🟡 (архів) FINDING-05 — Design system drift: hardcoded hex замість CSS-змінних

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

### ✅ FINDING-06 — `PATCH /deliveries/:id/start` повертає неповний об'єкт → crash у мобільному

**Статус:** Закрито — `startDelivery()` повертає повний об'єкт з `include: { order: { select: ... } }`.

---

### (архів оригінального опису)

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

### ✅ FINDING-07 — `GET /deliveries/active` не повертає `order.notes`

**Статус:** Закрито — `notes: true` додано до select у `proof-of-delivery.service.ts`.

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

### ✅ FINDING-08 — GPS ping endpoint зламаний: `courier_id` не надсилався з мобільного

**Статус:** Закрито — `courier_id` прибрано з `PingDto`, тепер береться з JWT (`user.courier_id`).

---

### ✅ FINDING-09 — Відсутній composite index `(courier_id, status)` на `deliveries`

**Статус:** Закрито — `@@index([courier_id, status])` додано в Prisma schema.

---

### ✅ FINDING-10 — Відсутній composite index `(courier_id, created_at)` на `location_pings`

**Статус:** Закрито — `@@index([courier_id, created_at(sort: Desc)])` додано в Prisma schema.

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

### ✅ FINDING-11 — Дублюючий endpoint реєстрації device token з несумісним DTO

**Статус:** Закрито — `POST /:id/device-token` і `RegisterDeviceTokenDto` видалені.

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

### ✅ INFO — `auto_dispatch` і `delivery_sla_minutes` реалізовані

Обидва поля тепер присутні в Prisma schema: `auto_dispatch Boolean @default(false)`, `delivery_sla_minutes Int?`, `lat Float?`, `lng Float?`. Реалізовано в рамках ETA/SLA фічі (2026-03-26).

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

**Дата закриття серії:** 2026-03-25
**Всього findings:** 11 (4 критичних 🔴, 5 середніх 🟡, 2 інформаційних 🔵)
**Статус:** ✅ Всі 11 закриті

| # | Finding | Пріоритет | Статус |
|---|---------|-----------|--------|
| 01 | Платформ-адмін панель (онбординг тенантів) | 🔴 | ✅ |
| 02 | Telegram notifications не підключені | 🟡 | ✅ |
| 03 | iiko server_url → SSRF | 🟡 | ✅ |
| 04 | CSS `--s1` не визначена → елементи без фону | 🔴 | ✅ |
| 05 | Hardcoded hex замість CSS-змінних | 🟡 | ✅ |
| 06 | `startDelivery()` повертає неповний об'єкт → crash mobile | 🔴 | ✅ |
| 07 | `order.notes` відсутній у відповіді активної доставки | 🟡 | ✅ |
| 08 | GPS ping: `courier_id` в body → 400 на кожному пінгу | 🔴 | ✅ |
| 09 | Composite index `(courier_id, status)` на deliveries | 🟡 | ✅ |
| 10 | Composite index `(courier_id, created_at DESC)` на location_pings | 🟡 | ✅ |
| 11 | Мертвий дублюючий endpoint device-token | 🟡 | ✅ |

**Що залишається відкритим (не з аудит-серії):**
- 🔵 INFO: Аудит #2 (TypeScript strict check) — проведено в окремій сесії, findings відсутні
