/**
 * tracker.js unit tests (Vitest + jsdom)
 *
 * Tests the public API and core behaviour of the customer tracking loader:
 *   - fetchToken: correct URL, 404→null, non-ok→null, network error→null
 *   - injectIframe: DOM injection, double-injection guard, minimize toggle
 *   - showError: injects error div with correct text, removes existing wrapper
 *   - track (integration): retry loop, success on Nth attempt, error after 15 failures
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchToken, injectIframe, showError, track } from '../index';

// ── helpers ────────────────────────────────────────────────────────────────

function makeOkResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function make404Response(): Response {
  return new Response('Not Found', { status: 404 });
}

function make500Response(): Response {
  return new Response('Error', { status: 500 });
}

// ── fetchToken ─────────────────────────────────────────────────────────────

describe('fetchToken', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls the correct URL with API key as query param', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeOkResponse({ token: 'tok-abc' }),
    );

    const result = await fetchToken('wgo_mykey123', 'order-42');

    expect(result).toBe('tok-abc');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/api/v1/public/order/order-42/token');
    expect(calledUrl).toContain('key=wgo_mykey123');
    // No POST body, no X-Api-Key header — GET only
    expect(fetchSpy.mock.calls[0][1]).toBeUndefined();
  });

  it('URL-encodes orderId and apiKey', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeOkResponse({ token: 't' }));

    await fetchToken('wgo_key with spaces', 'order/with/slashes');

    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
    expect(calledUrl).toContain(encodeURIComponent('order/with/slashes'));
    expect(calledUrl).toContain(encodeURIComponent('wgo_key with spaces'));
  });

  it('returns null on 404 (order not yet in DB)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(make404Response());
    const result = await fetchToken('wgo_key', 'missing-order');
    expect(result).toBeNull();
  });

  it('returns null on non-ok response (graceful)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(make500Response());
    const result = await fetchToken('wgo_key', 'order-1');
    expect(result).toBeNull();
  });

  it('returns null on network error (graceful)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network failure'));
    const result = await fetchToken('wgo_key', 'order-1');
    expect(result).toBeNull();
  });
});

// ── injectIframe ───────────────────────────────────────────────────────────

describe('injectIframe', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('injects wrapper and iframe into document.body', () => {
    injectIframe('tok-123', 'uk');

    const wrapper = document.getElementById('ownfleet-tracking-wrapper');
    const iframe = document.getElementById('ownfleet-tracking-iframe') as HTMLIFrameElement | null;
    expect(wrapper).not.toBeNull();
    expect(iframe).not.toBeNull();
    expect(iframe!.src).toContain('/embed/track/tok-123');
    expect(iframe!.src).toContain('lang=uk');
  });

  it('appends iframe src with correct lang parameter', () => {
    injectIframe('tok-en', 'en');
    const iframe = document.getElementById('ownfleet-tracking-iframe') as HTMLIFrameElement;
    expect(iframe.src).toContain('lang=en');
  });

  it('double-injection guard: second call is a no-op', () => {
    injectIframe('tok-a', 'uk');
    injectIframe('tok-b', 'uk'); // should not inject again

    const wrappers = document.querySelectorAll('#ownfleet-tracking-wrapper');
    expect(wrappers).toHaveLength(1);
    // First token still in src
    const iframe = document.getElementById('ownfleet-tracking-iframe') as HTMLIFrameElement;
    expect(iframe.src).toContain('tok-a');
  });

  // ── minimize toggle ──────────────────────────────────────────────────────

  it('minimize button toggles ownfleet-minimized class on wrapper', () => {
    injectIframe('tok-min', 'uk');
    const wrapper = document.getElementById('ownfleet-tracking-wrapper')!;
    const btn = document.getElementById('ownfleet-minimize-btn')!;

    expect(wrapper.classList.contains('ownfleet-minimized')).toBe(false);

    btn.click();
    expect(wrapper.classList.contains('ownfleet-minimized')).toBe(true);

    btn.click();
    expect(wrapper.classList.contains('ownfleet-minimized')).toBe(false);
  });

  it('minimize button hides iframe when minimized', () => {
    injectIframe('tok-min', 'uk');
    const iframe = document.getElementById('ownfleet-tracking-iframe') as HTMLIFrameElement;
    const btn = document.getElementById('ownfleet-minimize-btn')!;

    btn.click();
    expect(iframe.style.display).toBe('none');

    btn.click();
    expect(iframe.style.display).toBe('block');
  });

  it('minimize button updates aria-label', () => {
    injectIframe('tok-aria', 'uk');
    const btn = document.getElementById('ownfleet-minimize-btn')!;

    expect(btn.getAttribute('aria-label')).toBe('Згорнути');
    btn.click();
    expect(btn.getAttribute('aria-label')).toBe('Розгорнути');
    btn.click();
    expect(btn.getAttribute('aria-label')).toBe('Згорнути');
  });
});

// ── showError ──────────────────────────────────────────────────────────────

describe('showError', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('injects error div with Ukrainian message', () => {
    showError('uk');
    const el = document.getElementById('ownfleet-tracking-error');
    expect(el).not.toBeNull();
    expect(el!.textContent).toBe('Замовлення не знайдено. Спробуйте оновити сторінку.');
  });

  it('injects error div with English message', () => {
    showError('en');
    const el = document.getElementById('ownfleet-tracking-error');
    expect(el!.textContent).toBe('Order not found. Try refreshing the page.');
  });

  it('removes existing wrapper before injecting error', () => {
    injectIframe('tok-abc', 'uk');
    expect(document.getElementById('ownfleet-tracking-wrapper')).not.toBeNull();

    showError('uk');
    expect(document.getElementById('ownfleet-tracking-wrapper')).toBeNull();
    expect(document.getElementById('ownfleet-tracking-error')).not.toBeNull();
  });

  it('auto-hides after 10 seconds', () => {
    vi.useFakeTimers();
    showError('uk');
    expect(document.getElementById('ownfleet-tracking-error')).not.toBeNull();

    vi.advanceTimersByTime(10_001);
    expect(document.getElementById('ownfleet-tracking-error')).toBeNull();
  });
});

// ── track (integration) ────────────────────────────────────────────────────

describe('track', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('injects iframe immediately when token is returned on first attempt', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeOkResponse({ token: 'tok-first' }));

    await track({ apiKey: 'wgo_key', orderId: 'order-1' });

    expect(document.getElementById('ownfleet-tracking-wrapper')).not.toBeNull();
    expect(document.getElementById('ownfleet-tracking-error')).toBeNull();
  });

  it('injects iframe on the 3rd attempt (retries on 404)', async () => {
    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callCount++;
      if (callCount < 3) return make404Response();
      return makeOkResponse({ token: 'tok-retry' });
    });

    // track() resolves after attempt 1 (which schedules setTimeout for attempt 2)
    await track({ apiKey: 'wgo_key', orderId: 'order-retry' });

    // Fire remaining retries (each advanceTimersByTimeAsync flushes fetch microtasks too)
    await vi.advanceTimersByTimeAsync(2000); // attempt 2 → 404, schedules attempt 3
    await vi.advanceTimersByTimeAsync(2000); // attempt 3 → success, injects iframe

    expect(callCount).toBe(3);
    expect(document.getElementById('ownfleet-tracking-wrapper')).not.toBeNull();
    expect(document.getElementById('ownfleet-tracking-error')).toBeNull();
  });

  it('shows error message after 15 failed attempts', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(make404Response());

    // Attempt 1 fires synchronously (track resolves after it)
    await track({ apiKey: 'wgo_key', orderId: 'order-gone' });

    // Fire attempts 2–15 (14 more retries × 2s)
    for (let i = 0; i < 14; i++) {
      await vi.advanceTimersByTimeAsync(2000);
    }

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(15);
    expect(document.getElementById('ownfleet-tracking-wrapper')).toBeNull();
    expect(document.getElementById('ownfleet-tracking-error')).not.toBeNull();
    expect(document.getElementById('ownfleet-tracking-error')!.textContent).toBe(
      'Замовлення не знайдено. Спробуйте оновити сторінку.',
    );
  });

  it('stops retrying after successful token (does not fire 16th call)', async () => {
    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callCount++;
      return callCount === 1 ? make404Response() : makeOkResponse({ token: 'tok-stop' });
    });

    await track({ apiKey: 'wgo_key', orderId: 'order-stop' }); // attempt 1 → 404
    await vi.advanceTimersByTimeAsync(2000); // attempt 2 → success

    // Advance far past MAX_RETRIES to ensure no more calls
    await vi.advanceTimersByTimeAsync(60_000);
    expect(callCount).toBe(2);
  });

  it('uses Ukrainian error message by default (lang defaults to uk)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(make404Response());

    await track({ apiKey: 'wgo_key', orderId: 'order-lang' }); // attempt 1
    for (let i = 0; i < 14; i++) await vi.advanceTimersByTimeAsync(2000); // attempts 2–15

    const el = document.getElementById('ownfleet-tracking-error');
    expect(el!.textContent).toContain('Замовлення не знайдено');
  });
});
