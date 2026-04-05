# DEPLOY.md — Нотатки з деплою

> Цей файл фіксує деплойні рішення, відкриті питання та речі, які треба не забути при виході в прод.
> Не є покроковою інструкцією — це живий список ухвалених і відкладених рішень.

---

## OSRM (маршрутизація / ETA)

### Поточний стан
Код використовує публічний `https://router.project-osrm.org` (env `OSRM_URL`).
Публічний OSRM **заборонений для production-використання** за ToS — ризик блокування IP у будь-який момент.

### Що вирішено
- Деduплікація OSRM-запитів реалізована: замість N запитів на N курʼєрів — максимум 3 унікальних запити (по одному на унікальний transport mode серед кандидатів).
- Мопеди (`moto_gas`, `moto_electric`) не потребують окремого OSRM-профілю — обидва їздять по `driving`-дорогах. `moto_electric` коригується множником ×1.43 у коді після відповіді OSRM.

### Що треба зробити перед продом

**Підняти self-hosted OSRM з трьома профілями:**

| Профіль | Transport modes | Порт (пропозиція) |
|---------|----------------|-------------------|
| `driving` | car, moto_gas, moto_electric | 5000 |
| `cycling` | bicycle | 5001 |
| `foot` | walking | 5002 |

**Дані:** OSM-файл України (~600 МБ). Завантажити з [download.geofabrik.de/europe/ukraine.html](https://download.geofabrik.de/europe/ukraine.html).

**Мінімальні ресурси для всіх трьох профілів:**
- RAM: 4+ ГБ (driving ~2 ГБ, cycling ~0.8 ГБ, foot ~0.5 ГБ)
- Диск: 10+ ГБ
- Рекомендований хостинг на MVP: Hetzner CX31 (~€8/міс, Frankfurt або Helsinki)

---

### Env-змінні для self-hosted (рішення прийнято: три окремі URL)

`EtaService` підтримує per-profile URL з fallback на `OSRM_URL`:

```
OSRM_URL=https://router.project-osrm.org   # fallback / dev / поки немає self-hosted
OSRM_URL_DRIVING=http://<host>:5000         # car, moto_gas, moto_electric
OSRM_URL_CYCLING=http://<host>:5001         # bicycle
OSRM_URL_FOOT=http://<host>:5002            # walking
```

Якщо `OSRM_URL_DRIVING` / `_CYCLING` / `_FOOT` не виставлені — використовується `OSRM_URL`.
Backward-compatible: нічого не ламається до моменту деплою self-hosted.

### Швидкісні корекції (реалізовано в `EtaService`)

| Transport mode | Множник | Примітка |
|---|---|---|
| car | 1.0 | OSRM baseline |
| moto_gas | 1.0 | MVP: = авто. Тюнінг на реальних даних |
| moto_electric | 1.43 | ~35 км/г vs ~50 км/г авто |
| bicycle | 1.0 | OSRM cycling baseline |
| walking | 1.0 | OSRM foot baseline |

---

## Архітектура деплою (MVP)

### Принцип розподілу

Компоненти діляться на два типи:
- **Stateful** (тримають дані/стан постійно) → потрібен VPS: PostgreSQL, Redis, OSRM
- **Stateless** (запустив → відповів) → підходять managed платформи: API, Web

### Рекомендована архітектура: гібрид

```
Vercel (безкоштовно)        fly.io (~$6/міс)
      │                           │
  Next.js Web               NestJS API
      │                           │  WebSocket / HTTP
      └──────────────┬────────────┘
                     │
              Hetzner CX31 (€8.21/міс, Helsinki)
              ┌──────────────────────────────────┐
              │ PostgreSQL 15 + PostGIS  ~1.5 GB │
              │ Redis 7                  ~200 MB  │
              │ OSRM :5000 driving       ~2.0 GB  │
              │ OSRM :5001 cycling       ~0.8 GB  │
              │ OSRM :5002 foot          ~0.5 GB  │
              │ Grafana Alloy (sidecar)  ~100 MB  │
              │ Caddy (reverse proxy)    ~50  MB  │
              │ ─────────────────────────────     │
              │ Разом:                   ~5.2 GB  │
              │ Доступно:                   8 GB  │
              └──────────────────────────────────┘
```

CX31 має 8 GB RAM — вистачає для всіх stateful компонентів з ~2.5 GB запасу.

---

## Компоненти та рішення

### Next.js Web — Vercel (безкоштовно)

**Рішення: Vercel Hobby plan**

Дашборд менеджера — статичний фронтенд. Браузер сам підключається до API через HTTP/WebSocket. Next.js не тримає стан на сервері — serverless деплой підходить ідеально.
**Вартість: $0**

---

### NestJS API — fly.io

**Рішення: fly.io, shared-cpu-1x, 1 GB RAM**

Вимоги до платформи:
- Постійно запущений процес (Bull workers, cron, WebSocket) → `min_machines_running = 1`
- Підтримка WebSocket → є на fly.io
- Без sleep/auto-stop

fly.io `shared-cpu-1x` 1GB: ~$6.34/міс.

Альтернатива: Render Web Service $7/міс — трохи дорожче, але простіший CI/CD через GitHub.

**Важливо:** Socket.IO зараз без Redis adapter — API може працювати тільки в одній інстанції. Для MVP це норма. Перед горизонтальним масштабуванням: додати `@socket.io/redis-adapter`.

---

### PostgreSQL 15 + PostGIS — self-hosted (Hetzner)

**Рішення: self-hosted на Hetzner CX31** (разом з Redis і OSRM)

Чому не managed:
- Neon (serverless): може засинати → cold start під час dispatch → неприйнятно для real-time системи
- Supabase Pro: $25/міс + Prisma конфліктує з їхнім PgBouncer в transaction mode (потребує налаштувань)
- Railway PostgreSQL: ~$8-10/міс — розумний варіант якщо не хочеться ops, але дорожче за self-hosted
- Self-hosted: €0 зверху вартості сервера, повна підтримка PostGIS, `connection_limit=20` вже в `DATABASE_URL`

**Бекапи:** `pg_dump` до Cloudflare R2 — вже реалізовано в `RetentionModule` (щотижневий S3-бекап). Додатково: Hetzner snapshot (+€1.65/міс).

---

### Redis 7 — self-hosted (Hetzner, той самий сервер)

**Рішення: self-hosted на Hetzner CX31**

Чому не managed:
- Upstash (serverless Redis): підтримує `ioredis` і `BLPOP`, але free tier (10K команд/день) вичерпається за годину при активних GPS-пінгах. Pay-as-you-go ~$3-5/міс — варіант, але ризик несумісності з Bull на навантаженні
- Render Redis: $10/міс за 25MB або $20/міс за 100MB — дорого
- Redis Cloud Essentials ($7/міс): найнадійніший managed варіант якщо потрібна ізоляція від Hetzner-сервера
- Self-hosted: ~150MB RAM, живе на тому ж CX31 разом з PostgreSQL і OSRM — безкоштовно

---

### File Storage — Cloudflare R2

Free tier: 10 GB / 1M PUT / 10M GET на місяць.
MVP: ~50 доставок/день × 200KB фото = ~300MB/міс — далеко до ліміту.
**Вартість: $0**

---

### Push-нотифікації — Firebase FCM

Spark plan: необмежено. **Вартість: $0**

---

### Telegram-нотифікації

API безкоштовний, хостинг не потрібен. **Вартість: $0**

---

### Моніторинг — Grafana Cloud + Alloy

`infra/grafana-alloy/` вже налаштований. Free tier: 10K metric series, 50GB логів, 14 днів.
Для 1–10 закладів: вистачає.
**Вартість: $0** (Pro $29/міс якщо потрібно більше)

---

### SSL / Reverse Proxy — Caddy

Автоматичні Let's Encrypt сертифікати. Запускається на тому ж Hetzner сервері.
**Вартість: $0**

---

### Домен

**~$10–15/рік (~$1/міс)**

---

### Мобільний додаток (кур'єр) — React Native + Expo SDK 51

**Рішення: нативний додаток одразу (не PWA)**

PWA не підходить для кур'єрського додатку через обмеження iOS — фоновий GPS (пінг кожні 15с під час доставки) не працює в Safari PWA. React Native + Expo вже закладено в архітектурі — це правильне рішення.

**App Store (iOS):**
| | Коли | Сума |
|---|---|---|
| Apple Developer Program | Щорічно (одним платежем) | $99/рік |

Що потрібно зробити одноразово перед сабмітом:
- Згенерувати APNs ключ в Apple Developer Console → додати в Firebase (інакше push не працюють на iOS)
- Додати Privacy Policy сторінку (хоститься на тому ж Next.js, безкоштовно)
- При сабміті обґрунтувати фонову геолокацію — стандартна причина для кур'єрського додатку, Apple приймає

Білд через EAS Build (Expo) — безкоштовний тир 30 білдів/міс, Mac не потрібен.
App Store review: 1–3 дні на перший сабміт.

**Google Play (Android):**
| | Коли | Сума |
|---|---|---|
| Google Play Developer | Одноразово при реєстрації | $25 |

---

## Загальна вартість MVP

### Мінімум (без iOS, без snapshot-бекапів)

| Компонент | Платформа | Вартість |
|-----------|-----------|----------|
| Next.js Web | Vercel | $0 |
| NestJS API | fly.io | ~$6 |
| PostgreSQL + Redis + OSRM | Hetzner CX31 | €8.21 |
| R2, FCM, Telegram, Grafana | - | $0 |
| Домен | - | ~$1 |
| **Разом** | | **~$15–16/міс** |

### Реалістичний (з iOS + щоденні snapshot-бекапи)

| Компонент | Платформа | Вартість |
|-----------|-----------|----------|
| Next.js Web | Vercel | $0 |
| NestJS API | fly.io | ~$6 |
| PostgreSQL + Redis + OSRM | Hetzner CX31 | €8.21 |
| Hetzner snapshot (щодобово) | Hetzner | €1.65 |
| Apple Developer | Apple | $99/рік (разовий щорічний платіж) |
| Google Play | Google | $25 одноразово |
| Домен | - | ~$1/міс |
| **Разом** | | **~$16–17/міс + $99/рік Apple + $25 одноразово Google** |

> Render для всього (API + PostgreSQL + Redis): ~$54/міс без OSRM — не рекомендовано для MVP.
> Два Hetzner VPS (попередній варіант): €16.42/міс — теж ок, але більше ops і дорожче ніж гібрид.

---

## Коли виходити за межі MVP-архітектури

| Тригер | Що робити |
|--------|-----------|
| Кілька інстанцій API | Додати `@socket.io/redis-adapter` + load balancer |
| PostgreSQL > 50GB або сповільнюється | Перенести на окремий Hetzner CX41 (16GB) |
| OSRM > 80% CPU під навантаженням | Окремий Hetzner CX31 тільки для OSRM |
| Фото > 10GB/міс | R2 $0.015/GB — все ще дешево |
| Grafana free tier вичерпано | Grafana Cloud Pro $29/міс |
