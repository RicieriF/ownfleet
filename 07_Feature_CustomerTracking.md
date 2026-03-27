# Customer Tracking Widget — Специфікація

> Статус: Draft
> Пріоритет: High
> Залежності: OrdersModule, TrackingModule, EtaModule, WebhooksModule, GeocodingModule

---

## Що це і навіщо

Клієнт закладу замовляє доставку і одразу після підтвердження замовлення бачить живий трекер — де знаходиться курʼєр, коли приїде, маршрут на карті. Без SMS, без переходу на інший сайт, прямо на сторінці підтвердження замовлення.

**Цінність для закладу:**
- Різко скорочує кількість дзвінків "де моє замовлення?"
- Підвищує довіру клієнта до закладу
- Диференціює від конкурентів без власної системи трекінгу

**Цінність для клієнта:**
- Бачить статус замовлення в реальному часі
- Бачить GPS курʼєра на карті
- Знає точний орієнтовний час доставки

---

## Інтеграція на стороні закладу

Максимально проста — два кроки, один раз:

**Крок 1.** Вставити script tag в `<head>` сайту:
```html
<script src="https://weego.app/tracker.js" async></script>
```

**Крок 2.** На сторінці підтвердження замовлення додати один виклик:
```javascript
Weego.track('ORDER_ID');
```

де `ORDER_ID` — це той самий номер замовлення який сайт вже показує клієнту (і який Poster/iiko вже надсилає нам через webhook).

Після цього — більше нічого. Кожне нове замовлення автоматично отримує трекер.

---

## Як це працює технічно

```
Клієнт оформив замовлення → сайт показує сторінку підтвердження
    → Weego.track('123') викликається
    → tracker.js створює iframe оверлей
    → iframe звертається до нашого API з external_order_id=123
    → ми знаходимо замовлення (воно вже є — Poster надіслав webhook раніше)
    → повертаємо tracking token
    → iframe показує відповідний стан
    → WebSocket підтримує real-time оновлення
```

Номер замовлення ідентичний з обох сторін — Poster надсилає його нам як `external_id`, і він же відображається на сторінці підтвердження закладу. Ніякого додаткового співставлення не потрібно.

---

## Технічна архітектура

### tracker.js

Легкий loader (ціль: < 5kb, без залежностей):
- Приймає `ORDER_ID` через `Weego.track(id)`
- Звертається до `GET /api/v1/public/order/:externalId/token?key=API_KEY`
- Отримує tracking token
- Ін'єктує iframe оверлей на сторінку
- Передає token в iframe через URL: `/embed/track/TOKEN`

**Race condition — retry логіка:**
Webhook від Poster/iiko може оброблятись 2-3 секунди після того як клієнт вже бачить сторінку підтвердження. Якщо перший запит повертає 404 (замовлення ще не оброблено), tracker.js автоматично повторює запит:
- Retry кожні 2 секунди протягом 30 секунд
- Якщо протягом 30 секунд замовлення не з'явилось → показати "Замовлення не знайдено. Спробуйте оновити сторінку."
- Клієнт не бачить проміжний 404 — відразу бачить або лоадер, або повідомлення про помилку після timeout

API ключ закладу вбудовується в script tag при генерації в дашборді:
```html
<script src="https://weego.app/tracker.js?key=API_KEY" async></script>
```

### Hosted tracking page (для закладів без сайту)

Та сама сторінка `/embed/track/[token]` доступна і напряму в браузері — без iframe. Для закладів які не мають сайту або приймають замовлення через телефон/Telegram/Instagram.

**Сценарій:** менеджер (або Telegram-бот автоматично) надсилає клієнту:
```
Ваше замовлення прийнято! Відстежуйте доставку:
https://weego.app/t/TOKEN
```

Коротке посилання `/t/TOKEN` → redirect на `/embed/track/TOKEN` (відкривається повноекранно, не в iframe).

**Відмінності від iframe версії:**
- Повноекранний режим — немає вкладеності в чужий сайт
- Хедер показує logo/назву закладу більш помітно
- Back кнопка не потрібна (standalone сторінка)
- Ті самі UI стани, той самий WebSocket, та сама безпека

**Коли генерується посилання:**
- Автоматично через Telegram-бот: при переході замовлення в `assigned` бот надсилає менеджеру готове повідомлення зі скороченим посиланням — менеджер його просто пересилає клієнту. Керується тоглом в `/settings` (тільки якщо `hosted_tracking_enabled = true`)
- Вручну: менеджер копіює посилання з дашборду (кнопка "Копіювати посилання клієнту" поруч з замовленням, тільки якщо `hosted_tracking_enabled = true`)

### Нова таблиця: tracking_tokens

```sql
tracking_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES orders(id) UNIQUE,  -- один токен на замовлення
  token         TEXT UNIQUE NOT NULL,   -- UUID v4
  expires_at    TIMESTAMPTZ NOT NULL,   -- created_at + 4h
  created_at    TIMESTAMPTZ DEFAULT NOW()
)
-- Навмисно без establishment_id: доступ тільки через непередбачуваний UUID токен.
-- Виняток із правила multi-tenancy — токен сам є ключем ізоляції (122 bits entropy).
```

Токен створюється **ліниво** — при першому запиті від віджету (`GET /api/v1/public/order/:externalId/token`). Якщо токен для цього замовлення вже існує — повертається існуючий. `UNIQUE(order_id)` гарантує ідемпотентність навіть при паралельних запитах через `INSERT ... ON CONFLICT (order_id) DO NOTHING`. Прив'язаний до `order_id`, а не до `delivery_id`, бо доставка ще може не існувати в момент першого запиту. Термін дії — `NOW() + 4 години` від моменту створення.

### Нова таблиця: api_keys

```sql
api_keys (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id  UUID NOT NULL REFERENCES establishments(id),
  key_hash          TEXT NOT NULL,           -- bcrypt hash повного ключа
  key_prefix        TEXT NOT NULL,           -- перші 8 символів для відображення в UI
  name              TEXT NOT NULL,           -- "Основний сайт", "Мобільний додаток"
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  allowed_domains   TEXT[] NOT NULL DEFAULT '{}',
  -- Масив дозволених доменів: ['pizza-vezuviy.com.ua', 'www.pizza-vezuviy.com.ua']
  -- Порожній масив = ключ ще не налаштований, всі запити блокуються (крім localhost для тестування)
  -- Сервер порівнює Origin header запиту з цим списком; без збігу → 403 Forbidden
  last_used_at      TIMESTAMPTZ NULL,
  last_used_domain  TEXT NULL,              -- останній домен з якого використовувався ключ (аудит)
  created_at        TIMESTAMPTZ DEFAULT NOW()
)
```

### GeocodingModule (передумова для карти та ETA)

Карта і маршрут OSRM потребують `orders.lat` / `orders.lng`. Poster і iiko надсилають координати **опційно** — якщо адреса в POS не прив'язана до карти, `lat/lng` будуть відсутні в payload. Без координат віджет не може показати карту і порахувати ETA.

`GeocodingService` вирішує це автоматично при обробці кожного вхідного webhook в `IntegrationsModule`:

```
POS webhook → lat/lng є в payload      → зберігаємо як є
            → lat/lng відсутні          → GeocodingService.geocode(address)
                → Redis cache hit        → повертаємо кешовані координати миттєво
                → Nominatim API          → зберігаємо результат + кешуємо
                → Nominatim timeout/err  → lat=null, lng=null, Logger.warn (замовлення не блокується)
```

**Що показуємо без координат:** тільки текстовий статус доставки, карту і маршрут приховуємо.

**Технічні деталі:**
- **Nominatim (OpenStreetMap)** — безкоштовний, без API ключа, добре покриває українські адреси
- **Redis кеш:** ключ `geocode:{sha1(address.toLowerCase().trim())}` → `{lat, lng}`, TTL 30 днів. Одна адреса геокодується один раз незалежно від кількості замовлень на неї
- **Rate limit:** Nominatim вимагає не більше 1 req/sec. Bull черга з `limiter: { max: 1, duration: 1000 }`. Якщо є кеш — черга не потрібна (відповідь миттєво)
- **Timeout:** 2 секунди. Якщо Nominatim не відповів — `lat = null`, логуємо, продовжуємо
- **Геокодування синхронне** — виконується під час обробки webhook, до збереження замовлення. Якщо Nominatim недоступний — замовлення зберігається без координат (не блокуємо)
- **Міграція:** при деплої фічі запускати окремий скрипт для геокодування існуючих замовлень з `lat = null`

### Authenticated endpoint для менеджера (OrdersModule)

Окремий від публічних endpoints. Менеджер авторизований через JWT.

```
POST /api/v1/orders/:id/tracking-token
```
Захищений `JwtAuthGuard` + `PlanAccessGuard` + перевірка `establishment_id`.
Генерує (або повертає існуючий) tracking token для замовлення.
Відповідь: `{ url: "https://weego.app/t/TOKEN" }` — готове посилання для клієнта.
Ця URL копіюється в буфер при натисканні кнопки "Копіювати посилання клієнту" в дашборді.

Реалізація ідентична токенам від віджету: `INSERT ... ON CONFLICT (order_id) DO NOTHING`.
Одна таблиця `tracking_tokens`, той самий `expires_at = NOW() + 4h`, та сама `/embed/track/TOKEN` сторінка.

### PublicTrackingModule (NestJS)

Окремий модуль без `JwtAuthGuard` і `PlanAccessGuard`.

**Endpoints:**

```
GET  /api/v1/public/order/:externalId/token?key=API_KEY
```
Повертає tracking token для замовлення. Авторизація через API ключ. Використовується тільки tracker.js у браузері клієнта.

```
GET  /api/v1/public/track/:token
```
Snapshot доставки — статус, позиція курʼєра, ETA, маршрут, SLA.
Без авторизації — тільки валідація токена.

```
WS   /public  (окремий Socket.IO namespace)
```
Real-time оновлення. Auth через tracking token при підключенні.
Read-only. Клієнт підписується тільки на свою доставку.

**Що повертає snapshot:**
```typescript
{
  orderStatus: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'cancelled',
  deliveryStatus: 'assigned' | 'in_progress' | 'completed' | 'failed' | null,
  //   null = доставка ще не створена (замовлення в pending)
  //
  //   REASSIGNMENT RULE: snapshot завжди бере найновішу delivery для цього order
  //   (ORDER BY assigned_at DESC LIMIT 1 WHERE status != 'failed').
  //   Після reassign клієнт автоматично побачить нового курʼєра — без будь-яких
  //   додаткових дій з боку менеджера. WS подія delivery:status надсилається
  //   одразу при створенні нової delivery.

  courierName: string | null,
  //   null якщо delivery ще не створена

  courierLat: number | null,
  courierLng: number | null,
  //   Береться з Redis (останній GPS пінг), НЕ з БД.
  //   null якщо delivery не в in_progress, або пінгів ще не було.

  orderLat: number | null,
  orderLng: number | null,
  //   null якщо геокодування не вдалось. Карту і маршрут не показуємо.

  etaSeconds: number | null,
  //   Залишок часу до доставки в секундах. Логіка:
  //   - delivery відсутня або eta_seconds IS NULL → null
  //   - eta_started_at IS NULL (курʼєр ще не виїхав):
  //       повертаємо оригінальний deliveries.eta_seconds (розрахований при assign через OSRM)
  //   - eta_started_at IS NOT NULL (курʼєр виїхав):
  //       max(0, deliveries.eta_seconds - EXTRACT(EPOCH FROM (NOW() - eta_started_at))::int)
  //       → динамічний залишок який зменшується з часом
  //   Клієнт робить власний countdown між WS оновленнями (без додаткових запитів).

  routeGeometry: GeoJSON | null,
  //   OSRM маршрут від ПОТОЧНОЇ позиції курʼєра (з Redis) до orderLat/orderLng.
  //   null якщо: delivery не в in_progress, немає GPS пінгів, або orderLat/orderLng=null.
  //   Кешується в Redis: ключ `route:{delivery_id}`, TTL 10с.
  //   Перераховується через OSRM при кожному запиті якщо кеш протух.
  //   Через WS оновлюється подією delivery:route тільки коли курʼєр відхилився >50м від попереднього маршруту.

  slaDeadline: string | null,
  //   ISO timestamp дедлайну доставки. Логіка:
  //   - establishment.delivery_sla_minutes IS NULL → null (SLA не налаштовано)
  //   - delivery IS NULL (pending) → null (курʼєр не призначений, дедлайн не можна обіцяти)
  //   - delivery існує → COALESCE(orders.ready_at, orders.created_at) + interval
  //   Фіксований момент — не змінюється залежно від статусу доставки.

  establishmentName: string,
  //   Для брендингу в хедері iframe.

  tokenExpiresAt: string,
  //   ISO timestamp. Клієнт порівнює з NOW() — якщо протух, показує "трекінг недоступний".
}
```

**Валідація API ключа (endpoint `/api/v1/public/order/:externalId/token`):**
1. Отримати `key` з query string
2. За `key_prefix` (перші 8 символів) знайти запис у `api_keys` — уникаємо повного скану таблиці
3. `bcrypt.compare(key, key_hash)` — перевірка хешу
4. Перевірити `is_active = true`
5. Перевірити `Origin` header запиту проти `allowed_domains` — якщо немає збігу → `403 Forbidden`
6. Оновити `last_used_at` і `last_used_domain` (fire-and-forget, без блокування відповіді)

**Rate limiting (багаторівневий):**
- **60 req/хв на IP** — захист від простих ботів і DDoS
- **300 req/хв на API ключ** — захист від зловживання конкретним ключем, при цьому не обмежує заклади з великим трафіком
- **10 req/хв на tracking token** — захист від скрейпінгу через перебір активних токенів

### WebSocket — публічний namespace

Окремий namespace `/public` (існуючий namespace для менеджерів залишається незмінним).

При підключенні клієнт передає tracking token:
```javascript
io('/public', { auth: { token: 'TRACKING_TOKEN' } })
```

Сервер валідує токен → підписує socket на кімнату `delivery:{delivery_id}:public`.

**Події які отримує клієнт:**

| Подія | Payload | Коли |
|-------|---------|------|
| `courier:location` | `{ lat, lng }` | Кожен GPS пінг (15с) під час in_progress |
| `delivery:status` | `{ orderStatus, deliveryStatus }` | Зміна статусу delivery або order |
| `delivery:eta` | `{ etaSeconds }` | Кожні 60с під час in_progress |
| `delivery:route` | `{ routeGeometry: GeoJSON }` | Коли курʼєр відхилився >50м від попереднього маршруту |

`courier:location` і `delivery:route` — розділені навмисно: location пушиться на кожен пінг (легкий), route перераховується через OSRM тільки при значному відхиленні (важкий). Клієнт оновлює маркер на кожен location, але не перемальовує маршрут.

**TrackingModule** при кожному GPS пінгу публікує в Redis канал `delivery:{id}:public` → PublicTrackingModule пушить `courier:location`. Раз на 60с (окремий Redis timer) пушить `delivery:eta`. При значному зсуві маршруту — пушить `delivery:route`.

**Lifecycle WS при завершенні доставки:**
1. OrdersModule змінює `delivery.status → completed`
2. Публікує в Redis `delivery:{id}:public` подію `delivery:status`
3. PublicTrackingModule пушить клієнту `delivery:status { deliveryStatus: 'completed' }`
4. Клієнт показує "Доставлено!" екран
5. Через 15 хвилин після `delivery.completed_at` → сервер надсилає `error: TOKEN_EXPIRED` і розриває WS (`socket.disconnect(true)`)
6. Snapshot endpoint `GET /api/v1/public/track/:token` повертає 404 через 15 хвилин після `delivery.completed_at` — незалежно від `token.expires_at`

**Reconnection — поведінка tracker.js при розриві зʼєднання:**

Socket.IO має вбудований автоматичний reconnect. Після відновлення зʼєднання tracker.js:
1. Повторно аутентифікується з тим самим tracking token
2. Робить HTTP `GET /api/v1/public/track/:token` (snapshot) — щоб заповнити gap, поки не було зʼєднання
3. Оновлює UI відповідно до нового стану snapshot
4. Якщо token вже протух (expires_at < NOW()) → snapshot поверне 404 → показуємо статичний "трекінг недоступний"

Реалізація в tracker.js:
```javascript
socket.on('connect', () => {
  fetch(`/api/v1/public/track/${token}`)
    .then(r => r.ok ? r.json() : null)
    .then(snapshot => snapshot ? updateUI(snapshot) : showExpired());
});
```

---

## Embed сторінка — /embed/track/[token]

Next.js route, рендериться всередині iframe. Мобайл-фьорст.

**Мова інтерфейсу:** відповідає мові дашборду закладу (`establishments.settings.locale`). Поточно підтримується: українська (default), польська, російська — відповідно до `ALLOWED_TIMEZONES` логіки. Всі рядки UI embed-сторінки мають бути i18n-ready з першого дня (навіть якщо зараз тільки одна мова) — це виключає дорогий рефакторинг при додаванні наступної.

**Дизайн: світла тема** — окрема від темного дашборду менеджера. Embed відображається на сайтах ресторанів (здебільшого світлі) і бачиться клієнтами закладу, а не менеджерами. Білий фон, нейтральні кольори, наш sage акцент (`#3d7a5a`) для інтерактивних елементів.

### Стан 0 — замовлення очікує призначення (order: pending, delivery: null)

```
┌─────────────────────────────────┐
│  ✅ Замовлення прийнято          │
│                                  │
│  Ваше замовлення прийнято,       │
│  очікуємо призначення курʼєра.   │
│                                  │
│  ⏳ Підбираємо курʼєра...        │
└─────────────────────────────────┘
```

Стан активний з моменту першого виклику `Weego.track()` якщо доставка ще не створена. Токен генерується одразу — віджет показує проміжний стан очікування.

### Стан 1 — замовлення прийнято (delivery: assigned, курʼєр ще не виїхав)

```
┌─────────────────────────────────┐
│  ✅ Замовлення прийнято          │
│                                  │
│  Ваше замовлення збирається.     │
│  Курʼєр: Іван                   │
│                                  │
│  [карта з маркером закладу]      │
│                                  │
│  ⏳ Очікуємо виїзду курʼєра...   │
└─────────────────────────────────┘
```

### Стан 2 — курʼєр виїхав (delivery: in_progress)

Іконка транспорту береться з `courier.transport_mode`: 🚗 car / 🛵 moto_gas / ⚡ moto_electric / 🚲 bicycle / 🚶 walking.

**З координатами (orderLat/orderLng є):**
```
┌─────────────────────────────────┐
│  🛵 Іван їде до вас              │
│  ━━━━━━━━━━━━━━━  ~12 хв         │
│                                  │
│  [карта: маркер курʼєра +        │
│   маршрут до клієнта]            │
│                                  │
│  Очікуваний час: ~12 хв          │
│  Орієнтовно, на основі маршруту  │  ← дрібний текст
│  Доставка до: 18:30              │  ← якщо є SLA
└─────────────────────────────────┘
```

Коли `etaSeconds` відраховує до 0 → цифру прибираємо повністю. Карта з кур'єром залишається. Жодного тексту про час — найчесніший варіант.

**Без координат (orderLat/orderLng = null, геокодування не вдалось):**
```
┌─────────────────────────────────┐
│  🛵 Іван їде до вас              │
│                                  │
│  Очікуваний час: ~12 хв          │
│  Орієнтовно, на основі маршруту  │  ← дрібний текст
│  Доставка до: 18:30              │  ← якщо є SLA
└─────────────────────────────────┘
```

Карта і маршрут не показуються. Тільки текстовий статус і ETA.

### Стан 3 — доставлено

```
┌─────────────────────────────────┐
│  ✅ Доставлено!                  │
│                                  │
│  Дякуємо що обрали              │
│  Піцерія Везувій                 │
└─────────────────────────────────┘
```

### Стан 4 — скасовано (order: cancelled)

```
┌─────────────────────────────────┐
│  ❌ Замовлення скасовано         │
│                                  │
│  Зверніться до закладу для       │
│  уточнення деталей.              │
└─────────────────────────────────┘
```

### Стан 5 — доставка не вдалась (delivery: failed)

```
┌─────────────────────────────────┐
│  ⚠️ Не вдалось доставити         │
│                                  │
│  Курʼєр не зміг доставити        │
│  замовлення. Зверніться до       │
│  закладу для уточнення деталей.  │
└─────────────────────────────────┘
```

Відрізняється від "скасовано" тим що спроба доставки була, але невдала (клієнт не відчинив, адреса не знайдена тощо).

**Loading state:**
Між ін'єкцією iframe і першою відповіддю API — skeleton з pulse-анімацією сірого блоку форми віджета. Без тексту, без спінера. Виглядає як "зараз з'явиться", не як помилка.

**Show / Minimize:**
Віджет не можна закрити — це ключова фіча. Можна тільки згорнути.

- **Show (default):** повна карта + статус + ETA + ім'я кур'єра (поточні wireframes)
- **Minimized:** компактний рядок — іконка транспорту + короткий статус + ETA. Приклади:
  - State 0: `⏳ Замовлення прийнято`
  - State 1: `⏳ Замовлення збирається`
  - State 2: `🛵 Іван · ~12 хв`
  - State 3: `✅ Доставлено!`
- Кнопка ˄/˅ в кутку віджета для перемикання між режимами

**UX деталі:**
- Маркер курʼєра анімується при зміні позиції (плавне переміщення)
- Прогрес-бар ETA оновлюється в реальному часі
- На мобайлі — bottom sheet стиль
- На десктопі — floating card справа знизу (як Intercom)
- Назва та брендинг закладу у хедері
- Без навігації, без логіну, без зайвого

---

## Platform Admin Gate (Hosted Page)

Hosted tracking page — **opt-in фіча на рівні платформи**. Для переважної більшості закладів вона не потрібна і лише відволікає менеджера.

**Нове поле в `establishments`:**
```sql
hosted_tracking_enabled  BOOLEAN NOT NULL DEFAULT FALSE
```

Керується тільки через super admin панель (`is_platform_admin = true`). Менеджер закладу не може сам вмикати/вимикати.

**Що контролює цей флаг:**

Тільки елементи, пов'язані з hosted page:
1. Кнопка "Копіювати посилання клієнту" в таблиці активних доставок
2. Пояснювальна фраза в `/settings` під embed-кодом ("Немає сайту? Просто копіюйте посилання...")
3. Тогл "Надсилати посилання в Telegram автоматично" в `/settings`
4. Сама логіка Telegram auto-send при `pending → assigned` — не спрацьовує якщо флаг `false`

**Що флаг НЕ контролює:**
- Секція "Трекінг для клієнтів" в `/settings` — завжди видима
- Генерація API ключа і embed-код — завжди доступні
- Публічні endpoints `/api/v1/public/*` — завжди доступні

**Super admin panel** (окрема внутрішня сторінка, не для менеджерів):
- Список всіх тенантів
- Тогл "Hosted Tracking Page" per-establishment
- Вмикання/вимикання без перезапуску сервісу

---

## Дашборд менеджера — нові елементи

**Сторінка /settings — секція "Tracking Widget":**

Менеджер бачить мінімум — один екран, три дії:

```
┌─ Трекінг для клієнтів ─────────────────────────────┐
│                                                      │
│  Дозволяє клієнтам бачити де знаходиться курʼєр     │
│  прямо на вашому сайті.                             │
│                                                      │
│  Адреса вашого сайту                                │
│  [ pizza-vezuviy.com.ua              ]              │
│                                                      │
│  Код для вашого розробника           [Копіювати 📋]  │
│  ┌──────────────────────────────────────────────┐   │
│  │ <script src="https://weego.app/tracker.js    │   │
│  │   ?key=wg_xxxxxxxx" async></script>          │   │
│  │ <script>Weego.track('ORDER_ID')</script>     │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  ─ ─ ─ якщо hosted_tracking_enabled = true ─ ─ ─   │
│  Немає сайту? Копіюйте посилання для кожного         │
│  замовлення прямо з таблиці доставок.               │
│                                                      │
│  Telegram-сповіщення при призначенні курʼєра         │
│  Надсилати посилання в Telegram автоматично  [●]    │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─   │
│                                                      │
│                              [Вимкнути віджет]       │
└──────────────────────────────────────────────────────┘
```

**Логіка UI:**
- Менеджер вводить адресу сайту один раз → система автоматично заповнює `allowed_domains`
- API ключ генерується автоматично при першому збереженні сайту — менеджер його не бачить окремо, він вже вшитий у готовий код
- Копіює код → дає розробнику сайту → більше нічого не потрібно
- "Надсилати посилання в Telegram" — зберігається в `establishments.settings.tracking_telegram_notify` (boolean, default `false`). Тогл видимий тільки якщо `hosted_tracking_enabled = true`
- "Вимкнути" — soft disable (`is_active = false`); ключ і налаштування зберігаються. Вже активні tracking sessions не переривається

**Головна сторінка `/` — таблиця активних доставок:**

Коли `hosted_tracking_enabled = true` і delivery в статусі `in_progress` — у рядку доставки з'являється кнопка:

```
[📋 Посилання клієнту]
```

Тап → копіює `https://weego.app/t/TOKEN` в буфер. Менеджер пересилає клієнту у Telegram/Viber/SMS. Токен генерується ліниво при першому натисканні.

Для закладів без сайту — це єдиний спосіб ділитись трекінгом. Для закладів з віджетом — додатковий канал (наприклад, для замовлень по телефону).

Все що стосується безпеки (ключі, домени, rate limiting, аудит) — **невидиме для менеджера, автоматичне**.

---

## Безпека

### Модель захисту API ключа

API ключ — **публічний за дизайном**, як Stripe publishable key або Google Maps API key. Він знаходиться у вихідному коді сторінки закладу і це нормально — він не дає доступу до приватних даних. Реальний захист забезпечується трьома рівнями:

**Рівень 1 — Domain restriction (основний захист):**
Сервер перевіряє `Origin` header кожного запиту до `/api/v1/public/*` проти `api_keys.allowed_domains`. Навіть якщо хтось скопіював ключ — використати його можна тільки з зареєстрованого домену закладу.
- `allowed_domains: []` → всі запити блокуються (ключ щойно створений, ще не налаштований)
- `allowed_domains: ['pizza-vezuviy.com.ua']` → тільки цей домен
- `localhost` завжди дозволений для тестування (лише в development режимі)
- Обмеження: `Origin` header виставляється браузером автоматично і не може бути підроблений JS. Але server-side скрипт (curl, Python) може виставити будь-який Origin. Тому domain restriction — необхідний але не єдиний захист.

**Рівень 2 — Tracking token як ізоляція:**
Навіть знаючи API ключ і `external_id` замовлення — зловмисник отримає tracking token прив'язаний тільки до цього одного замовлення. UUID v4 (122 bits entropy) — перебір нереальний.

**Рівень 4 — Захист від перебору `external_id`:**

Poster і iiko використовують **послідовні числові** номери замовлень (`external_id`: 1001, 1002, 1003...). Теоретично зловмисник з валідним API ключем може перебирати їх і отримувати tracking tokens для всіх замовлень закладу.

Що він отримає: імʼя курʼєра, поточну GPS-позицію, ETA. Цінність для конкурента — мінімальна, але захист все одно потрібен.

Митигація — **автоматичний throttle на невдалі запити** (невидимий для менеджера):
- Якщо один API ключ генерує >10 послідовних 404 за хвилину → тимчасовий бан ключа на 5 хвилин
- При повторенні → бан збільшується (exponential backoff: 5хв → 15хв → 1год)
- Легітимний трафік: клієнт запитує токен одразу після оформлення замовлення — один запит, не серія 404

Прийнята залишкова ризик: зловмисник з терпінням може повільно перебирати (1 запит на 6 сек, 10/хв) і знаходити активні замовлення. Але отримані дані (позиція курʼєра) мають TTL доставки і не несуть критичної цінності.

**Рівень 3 — Багаторівневий rate limit:**
- 60 req/хв на IP (базовий захист від ботів)
- 300 req/хв на API ключ (захист від зловживання конкретним ключем)
- 10 req/хв на tracking token (захист від скрейпінгу)

### Lifecycle tracking token

```
Токен створено: expires_at = created_at + 4h
Доставка завершена: delivery.completed_at встановлено

Ефективний TTL = min(token.expires_at, delivery.completed_at + 15min)

Через 15 хв після completed_at:
  → GET /api/v1/public/track/:token → 404
  → WS: сервер надсилає { error: 'TOKEN_EXPIRED' } → socket.disconnect(true)
```

15 хвилин після завершення — достатньо щоб клієнт побачив "Доставлено!" і закрив вікно.

### Embed сторінка — HTTP security headers

Next.js middleware для всіх `/embed/track/*` маршрутів:
```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https://*.tile.openstreetmap.org;
  connect-src 'self' wss: https://*.openstreetmap.org;
  frame-ancestors *;           ← дозволяємо embed в будь-який iframe

X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
```

`frame-ancestors *` замість `X-Frame-Options: ALLOW-FROM` — сучасний стандарт, підтримується всіма браузерами. Дозволяє вставляти embed у будь-який сайт закладу без whitelist на рівні headers (domain restriction вже є на рівні API ключа).

### Що не витікає

| Поле | Чому не повертається |
|------|---------------------|
| `establishment_id` | Внутрішній UUID, клієнту не потрібен |
| `delivery_id` | Не повертається в snapshot; WS кімната відома тільки серверу |
| Телефон курʼєра | Явно виключений |
| GPS-історія | Тільки поточна позиція з Redis |
| Дані інших замовлень | Токен прив'язаний до одного `order_id` |
| `order_id` / `courier_id` | Внутрішні UUID, не повертаються |

---

## Що НЕ показуємо клієнту

- Телефон курʼєра
- Маршрут від закладу до курʼєра (до виїзду)
- GPS-історія курʼєра
- Дані інших замовлень
- Будь-яка внутрішня бізнес-інформація закладу

---

## План реалізації

### Фаза 0 — GeocodingModule (блокер, робиться першим)
1. `GeocodingModule` — `GeocodingService` з Nominatim + Redis кеш + Bull черга
2. Інтеграція в `IntegrationsModule` — geocode при обробці Poster і iiko webhook
3. Міграція-скрипт для геокодування існуючих `orders` з `lat = null`
4. Тести: geocode успішно → координати збережені; Nominatim timeout → null, без блокування; кеш hit → Nominatim не викликається

### Фаза 1 — Бекенд
1. Міграція: `establishments.hosted_tracking_enabled BOOLEAN NOT NULL DEFAULT FALSE` + `tracking_tokens` (з `UNIQUE(order_id)`) + `api_keys` (з `is_active`, `allowed_domains`, `last_used_domain`) таблиці
2. `ApiKeysModule` — авто-генерація ключа при збереженні сайту; toggle is_active; `allowed_domains` заповнюється автоматично з поля "Адреса сайту" в /settings
3. `PublicTrackingModule` — endpoints + багаторівневий rate limiting (per-IP + per-key + per-token)
4. Domain restriction middleware: перевірка `Origin` header проти `allowed_domains`
5. Лінива генерація токена: два флоу — від віджету (публічний endpoint з API ключем) та від менеджера (`POST /api/v1/orders/:id/tracking-token`, JwtAuthGuard). Обидва використовують `INSERT ... ON CONFLICT (order_id) DO NOTHING` в одну таблицю
6. Публічний WebSocket namespace `/public`
7. TrackingModule: публікація GPS пінгів в `delivery:{id}:public` Redis канал
8. WS lifecycle: disconnect через 15 хв після `delivery.completed_at`
9. RetentionModule: cron для очищення `tracking_tokens` де `min(expires_at, completed_at + 15min) < NOW()`

### Фаза 2 — Embed сторінка
1. `/embed/track/[token]` — Next.js route
2. 4 стани UI з відповідними компонентами
3. Leaflet карта + анімований маркер курʼєра
4. OSRM маршрут курʼєр → клієнт
5. ETA countdown + SLA таймер
6. WebSocket підключення для real-time

### Фаза 3 — tracker.js + hosted page + дашборд
1. `tracker.js` loader — vanilla JS, без залежностей; включаючи retry логіку (2с × 15 спроб = 30с)
2. Iframe оверлей логіка (show/minimize)
3. Hosted page: `/embed/track/[token]` в standalone режимі + `/t/[token]` redirect (short URL)
4. Секція в /settings — завжди видима: генерація API ключа + copy-paste код + пояснювальна фраза про hosted page (умовна: тільки якщо `hosted_tracking_enabled = true`)
5. Кнопка "Копіювати посилання клієнту" в таблиці активних доставок — умовна (тільки якщо `hosted_tracking_enabled = true` і delivery `in_progress`)
6. Super admin panel: тогл `hosted_tracking_enabled` per-establishment
7. `tracker.js` розміщується в `/public` папці Next.js — доступний за `https://weego.app/tracker.js`. Ніякого окремого CDN. Якщо сервер ліг — трекінг однаково не працює, тому окрема інфраструктура не потрібна.

### Фаза 4 — Тести
**API ключ і domain restriction:**
- Валідний ключ + домен в `allowed_domains` → 200
- Валідний ключ + домен НЕ в `allowed_domains` → 403
- Валідний ключ + `allowed_domains: []` → 403
- Невалідний ключ → 401
- `is_active: false` → 401
- Rate limit per-IP → 429 після 60 req/хв
- Rate limit per-key → 429 після 300 req/хв
- `last_used_domain` оновлюється після успішного запиту

**Захист від перебору external_id:**
- 10 послідовних 404 від одного ключа за хвилину → ключ заблокований на 5 хв
- Після розблокування: повторення → 15 хв, потім 1 год
- Легітимний запит (один 404 потім 200) → throttle не спрацьовує

**Tracking token:**
- Ідемпотентність: паралельні запити повертають той самий токен (UNIQUE + ON CONFLICT)
- Expired token (`expires_at < NOW()`) → 404
- Токен після `delivery.completed_at + 15min` → 404 (незалежно від `expires_at`)
- Токен доставки в `in_progress` → коректний snapshot
- Rate limit per-token → 429 після 10 req/хв

**WebSocket:**
- Невалідний tracking token → відхилення при підключенні
- Після `delivery:completed` → клієнт отримує `delivery:status` подію
- Через 15 хв після `delivery.completed_at` → WS розривається з `TOKEN_EXPIRED`
- Reconnect: клієнт переконнектується → snapshot оновлюється

**Multi-tenant і ізоляція:**
- Токен замовлення A не дає доступу до даних замовлення B
- `delivery_id` не повертається в жодному публічному endpoint

**Retention:**
- Expired tokens прибираються cron-ом
- `delivery_proofs` при цьому не чіпаються (незмінна вимога)

---

## Відкриті питання

- [ ] Чи показувати трекер одразу при `assigned` (курʼєр прийняв) чи тільки при `in_progress` (виїхав)?
      → Поки: показувати з `assigned`, з різними UI станами
- [ ] Кастомний логотип закладу в хедері iframe?
      → Поки: тільки назва закладу текстом
- [ ] Що показувати якщо замовлення ще в статусі `pending` (не assigned)?
      → Поки: "Замовлення прийнято, очікуємо призначення курʼєра"
