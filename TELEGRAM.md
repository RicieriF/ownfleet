# @weego CMI — Telegram Bot: Технічна специфікація

> Статус: 📋 Заплановано
> Пріоритет: середній — опціональна фіча, не блокує базовий флоу
> Залежності: TELEGRAM_BOT_TOKEN вже в .env, NotificationsService вже реалізований

---

## 1. Ідея

Один платформний Telegram-бот для всіх закладів. Менеджери та власники підключаються через дашборд, курʼєри — через мобільний додаток. Після підключення кожен обирає які сповіщення хоче отримувати. Хто не хоче — просто не підключається, нічого не ламається.

---

## 2. Аутентифікація (підключення боту)

**Проблема:** не можна просити пароль у Telegram-чаті — небезпечно і незручно.

**Рішення — одноразовий код:**

```
Дашборд/Мобільний                  API                        Telegram Bot
      |                              |                               |
      |-- POST /telegram/connect --> |                               |
      |                              | генерує код "4829-XK"         |
      |                              | зберігає в Redis TTL=600s     |
      |<-- { code: "4829-XK" } ----- |                               |
      |                              |                               |
   Юзер відкриває бота, пише /start 4829-XK                         |
      |                              |<-- Telegram webhook --------- |
      |                              | знаходить код у Redis         |
      |                              | зберігає chat_id в users      |
      |                              | видаляє код з Redis           |
      |                              |-- "✅ Підключено!" ---------> |
```

**Деталі коду:**
- Формат: `XXXX-XX` (4 цифри + 2 великі літери), генерується через `crypto.randomBytes`
- TTL: 10 хвилин
- Одноразовий: після використання видаляється з Redis
- Зберігається в Redis як `telegram:connect:{code}` → `{ user_id, establishment_id }`

---

## 3. Зміни в базі даних

### 3.1 Таблиця `users` — додати поле

```prisma
model User {
  // ... існуючі поля ...
  telegram_chat_id        String?   // chat ID після підключення бота
  telegram_prefs          Json?     // { order_created: true, delivery_completed: false, ... }
}
```

### 3.2 Таблиця `couriers` — вже є `telegram_chat_id`, додати `telegram_prefs`

```prisma
model Courier {
  // ... існуючі поля ...
  // telegram_chat_id вже є
  telegram_prefs          Json?     // { delivery_assigned: true, manager_reminder: true, ... }
}
```

### Міграція

```sql
ALTER TABLE "users" ADD COLUMN "telegram_chat_id" TEXT;
ALTER TABLE "users" ADD COLUMN "telegram_prefs" JSONB DEFAULT '{}';
ALTER TABLE "couriers" ADD COLUMN "telegram_prefs" JSONB DEFAULT '{}';
```

---

## 4. Список сповіщень

### Для менеджерів / власників (через дашборд)

| Ключ | Опис | Коли надсилається |
|------|------|-------------------|
| `order_created` | Нове замовлення надійшло | `POST /api/v1/orders` |
| `delivery_assigned` | Курʼєру призначено доставку | `PATCH /orders/:id/assign` |
| `delivery_completed` | Доставка завершена | `ProofOfDeliveryService.completeDelivery()` |
| `delivery_failed` | Доставка провалена | `ProofOfDeliveryService.failDelivery()` |
| `delivery_force_closed` | Доставку закрито вручну | `ProofOfDeliveryService.forceCloseDelivery()` |
| `courier_shift_started` | Курʼєр вийшов на зміну | `ShiftsService.startShift()` |
| `courier_shift_ended` | Курʼєр завершив зміну | `ShiftsService.endShift()` |
| `courier_shift_auto_closed` | Зміну закрито автоматично (16+ год) | `ShiftsService.autoCloseStaleShifts()` |
| `courier_not_responding` | Курʼєр не відповідає > 5 хв під час доставки | Cron / ping staleness check |

### Для курʼєрів (через мобільний додаток)

| Ключ | Опис | Коли надсилається |
|------|------|-------------------|
| `delivery_assigned` | Нова доставка призначена мені | `PATCH /orders/:id/assign` |
| `manager_reminder` | Нагадування від менеджера | `CouriersService.remind()` |
| `shift_ending_soon` | Зміна закінчується через 30 хв | Cron (якщо `planned_end_at` встановлено) |

---

## 5. Формат повідомлень

Всі повідомлення — прості, без markdown-перевантаження. Приклади:

```
📦 Нове замовлення #1042
вул. Хрещатик, 22
2 позиції · Піца Маргарита, Кола

🏁 Доставка завершена
Іваненко Олексій · #1042
📍 В радіусі 300м ✓

⚠️ Зміну закрито автоматично
Петренко Василь — 18 год без активності

🛵 Курʼєр вийшов на зміну
Сидоренко Марія · 09:34
```

---

## 6. API ендпоінти

### Telegram Connect
```
POST   /api/v1/telegram/connect          → генерує одноразовий код (JWT required)
DELETE /api/v1/telegram/connect          → відʼєднати бота (видаляє chat_id)
GET    /api/v1/telegram/status           → { connected: bool, prefs: {...} }
```

### Telegram Preferences
```
PATCH  /api/v1/telegram/prefs            → { order_created: bool, ... } оновити преференції
```

### Telegram Webhook (платформний, без JWT — Telegram сам дзвонить)
```
POST   /api/v1/telegram/webhook          → обробляє /start {code} від Telegram
```

---

## 7. Команди бота

| Команда | Дія |
|---------|-----|
| `/start {code}` | Підключити акаунт (код з дашборду/додатку) |
| `/stop` | Відʼєднати — більше не отримувати сповіщень |
| `/status` | Показати які сповіщення увімкнені |

---

## 8. UI зміни

### Веб-дашборд (Налаштування → новий блок "Telegram")

```
┌─ TELEGRAM СПОВІЩЕННЯ ──────────────────────────────────┐
│                                                         │
│  ○ Не підключено                    [Підключити]        │
│                                                         │
│  Після натискання — покажемо код на 10 хвилин.         │
│  Введіть його в боті @weego_notify_bot                  │
│                                                         │
└─────────────────────────────────────────────────────────┘

// Після підключення:

┌─ TELEGRAM СПОВІЩЕННЯ ──────────────────────────────────┐
│  ✅ Підключено                      [Відʼєднати]        │
│  ─────────────────────────────────────────────────────  │
│  ЗАМОВЛЕННЯ                                             │
│  ☑ Нове замовлення надійшло                             │
│  ☑ Доставка завершена                                   │
│  ☐ Доставка призначена курʼєру                          │
│  ☐ Доставка провалена                                   │
│                                                         │
│  КУРЄРИ                                                 │
│  ☑ Зміну закрито автоматично                            │
│  ☑ Курʼєр не відповідає                                 │
│  ☐ Курʼєр вийшов на зміну                               │
│  ☐ Курʼєр завершив зміну                                │
│                                                         │
│                              [Зберегти налаштування]    │
└─────────────────────────────────────────────────────────┘
```

### Мобільний додаток (Профіль → Сповіщення)

```
┌─ TELEGRAM ─────────────────────────────────────────────┐
│  Не підключено                                          │
│  [Підключити Telegram]                                  │
└─────────────────────────────────────────────────────────┘

// Після підключення:

┌─ TELEGRAM ─────────────────────────────────────────────┐
│  ✅ Підключено · [Відʼєднати]                           │
│                                                         │
│  ☑ Нова доставка призначена                             │
│  ☑ Нагадування від менеджера                            │
│  ☐ Зміна скоро закінчується                             │
└─────────────────────────────────────────────────────────┘
```

---

## 9. Модуль NestJS: `TelegramModule`

```
src/telegram/
  telegram.module.ts
  telegram.controller.ts      ← /connect, /prefs, /status, /webhook
  telegram.service.ts         ← генерація коду, обробка /start, надсилання повідомлень
  telegram.types.ts           ← ManagerPrefs, CourierPrefs interfaces
  __tests__/
    telegram.service.spec.ts
```

**TelegramService** інжектується в:
- `OrdersService` — `order_created`, `delivery_assigned`
- `ProofOfDeliveryService` — `delivery_completed`, `delivery_failed`, `delivery_force_closed`
- `ShiftsService` — `courier_shift_started`, `courier_shift_ended`, `courier_shift_auto_closed`
- `CouriersService` — `manager_reminder`

Завжди fire-and-forget: `.catch(err => logger.warn(...))`

---

## 10. План реалізації (кроки по порядку)

| # | Крок | Що робимо |
|---|------|-----------|
| 1 | **DB міграція** | Додати `telegram_prefs` до `users` і `couriers` |
| 2 | **TelegramModule** | Базовий модуль, сервіс з `sendMessage()`, webhook обробник `/start` + `/stop` |
| 3 | **Connect flow** | `POST /telegram/connect` → Redis код, `/start {code}` → зберегти chat_id |
| 4 | **Prefs API** | `GET/PATCH /telegram/prefs` — читати/зберігати преференції |
| 5 | **Веб UI** | Блок в Settings: підключення + чекбокси |
| 6 | **Підключити виклики** | Orders, ProofOfDelivery, Shifts, Couriers — надсилати з перевіркою prefs |
| 7 | **Мобільний UI** | Екран в профілі курʼєра: підключення + чекбокси |
| 8 | **Тести** | Unit тести TelegramService, інтеграційні для connect flow |

---

## 11. Що НЕ робимо (scope обмеження)

- ❌ Двосторонній чат через бота (бот тільки надсилає, не приймає команди менеджменту)
- ❌ Групові чати / канали (тільки особисті повідомлення)
- ❌ Медіа / фото (тільки текст)
- ❌ Scheduled digests (зведення за день) — можна як наступна ітерація

---

## 12. Технічні нюанси

**Webhook vs Polling:**
Використовуємо Telegram Webhook (не polling) — API отримує push від Telegram при кожному повідомленні. Потрібен публічний HTTPS URL → в dev середовищі використовувати ngrok або схожий тунель.

**Безпека webhook:**
Telegram дозволяє встановити secret token для webhook — додаємо `X-Telegram-Bot-Api-Secret-Token` header validation, щоб ніхто інший не міг надсилати запити на наш webhook endpoint.

**Default prefers:**
При першому підключенні — вмикаємо найважливіші за замовчуванням:
- Менеджер: `order_created=true`, `courier_shift_auto_closed=true`, `courier_not_responding=true`
- Курʼєр: `delivery_assigned=true`, `manager_reminder=true`

**Rate limits:**
Telegram дозволяє 30 повідомлень/секунду на бота. При великій кількості закладів — надсилати через Bull queue (той самий підхід що і GPS пінги).
