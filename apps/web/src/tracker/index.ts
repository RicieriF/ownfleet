/**
 * Weego customer tracking loader (tracker.js)
 *
 * Embed on restaurant's website:
 *   <script src="https://weego.app/tracker.js"
 *           data-api-key="wgo_xxxxxx"
 *           data-order-id="1234"
 *           data-lang="uk"></script>
 *
 * Or call imperatively after DOMContentLoaded:
 *   Weego.track({ apiKey: 'wgo_xxx', orderId: '1234' });
 *
 * What it does:
 * 1. Calls GET /api/v1/public/order/:externalId/token?key=API_KEY to get a tracking token
 * 2. Injects a fixed-position iframe that shows the tracking widget
 * 3. Retries up to 15 times (every 2s) if the order isn't found yet
 *    (handles the race between POS webhook and customer page load)
 */

declare const __WEEGO_BASE_URL__: string;

type Lang = 'uk' | 'en';

interface TrackOptions {
  apiKey: string;
  orderId: string;
  lang?: Lang;
}

interface TokenResponse {
  token: string;
}

const BASE_URL = typeof __WEEGO_BASE_URL__ !== 'undefined'
  ? __WEEGO_BASE_URL__
  : 'https://weego.app';

const MAX_RETRIES = 15;
const RETRY_DELAY_MS = 2000;

const ERROR_MSG: Record<Lang, string> = {
  uk: 'Замовлення не знайдено. Спробуйте оновити сторінку.',
  en: 'Order not found. Try refreshing the page.',
};

function injectIframe(token: string, lang: Lang): void {
  // Avoid double injection
  if (document.getElementById('weego-tracking-wrapper')) return;

  const wrapper = document.createElement('div');
  wrapper.id = 'weego-tracking-wrapper';
  wrapper.style.cssText = [
    'position:fixed',
    'bottom:16px',
    'right:16px',
    'z-index:2147483647',
    'width:360px',
    'max-width:calc(100vw - 32px)',
    'max-height:80vh',
    'overflow:hidden',
    'border-radius:12px',
    'box-shadow:0 8px 32px rgba(0,0,0,0.18)',
    'transition:opacity 0.2s',
  ].join(';');

  const src = `${BASE_URL}/embed/track/${encodeURIComponent(token)}?lang=${lang}`;

  const iframe = document.createElement('iframe');
  iframe.src = src;
  iframe.setAttribute('allow', 'geolocation');
  iframe.setAttribute('loading', 'eager');
  iframe.style.cssText = [
    'width:100%',
    'height:520px',
    'max-height:80vh',
    'border:none',
    'display:block',
  ].join(';');

  wrapper.appendChild(iframe);
  document.body.appendChild(wrapper);
}

async function fetchToken(apiKey: string, orderId: string): Promise<string | null> {
  try {
    const url = `${BASE_URL}/api/v1/public/order/${encodeURIComponent(orderId)}/token?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);

    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = (await res.json()) as TokenResponse;
    return data.token;
  } catch {
    return null;
  }
}

function showError(lang: Lang): void {
  const existing = document.getElementById('weego-tracking-wrapper') ?? document.getElementById('weego-tracking-error');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.id = 'weego-tracking-error';
  el.style.cssText = [
    'position:fixed',
    'bottom:16px',
    'right:16px',
    'z-index:2147483647',
    'padding:12px 16px',
    'background:#fff',
    'border-radius:10px',
    'box-shadow:0 4px 20px rgba(0,0,0,0.14)',
    'font-family:system-ui,sans-serif',
    'font-size:13px',
    'color:#374151',
    'max-width:calc(100vw - 32px)',
    'width:320px',
    'line-height:1.5',
  ].join(';');
  el.textContent = ERROR_MSG[lang];
  document.body.appendChild(el);

  // Auto-hide after 10s
  setTimeout(() => el.remove(), 10_000);
}

async function track(options: TrackOptions): Promise<void> {
  const { apiKey, orderId, lang = 'uk' } = options;

  let attempts = 0;

  async function attempt(): Promise<void> {
    attempts++;
    const token = await fetchToken(apiKey, orderId);

    if (token) {
      injectIframe(token, lang);
      return;
    }

    // 404 — order not yet in DB (POS webhook delay). Retry.
    if (attempts < MAX_RETRIES) {
      setTimeout(attempt, RETRY_DELAY_MS);
      return;
    }

    // All retries exhausted
    showError(lang);
  }

  await attempt();
}

// Auto-init from script data attributes
function autoInit(): void {
  const scripts = document.querySelectorAll<HTMLScriptElement>('script[data-api-key]');
  scripts.forEach((script) => {
    const apiKey = script.getAttribute('data-api-key');
    const orderId = script.getAttribute('data-order-id');
    if (!apiKey || !orderId) return;
    const lang = (script.getAttribute('data-lang') as Lang | null) ?? 'uk';
    track({ apiKey, orderId, lang }).catch(() => {});
  });
}

// Public API
(window as unknown as Record<string, unknown>).Weego = { track };

// Auto-init on script load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', autoInit);
} else {
  autoInit();
}
