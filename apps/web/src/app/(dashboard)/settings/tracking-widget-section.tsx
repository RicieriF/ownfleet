'use client';

/**
 * Tracking Widget Section — /settings
 *
 * Guided 3-step setup for customer tracking integration:
 *   Step 1 — Website domain
 *   Step 2 — API key (generate once, shown once)
 *   Step 3 — Embed code snippet
 *   Step 4 — Hosted tracking page (optional, super-admin only)
 */

import { useState, useRef, useEffect } from 'react';
import { apiGet, apiPost, apiPatch } from '@/lib/api-client';
import { ApiKeyMeta } from '@/types';
import { useT } from '@/lib/i18n/client';

interface Props {
  initialApiKey: ApiKeyMeta | null;
  hostedTrackingEnabled: boolean;
}

function copyToClipboard(text: string, onDone: () => void): void {
  navigator.clipboard.writeText(text).then(onDone).catch(() => {});
}

function formatDate(iso: string | null, t: (s: string) => string): string {
  if (!iso) return t('ніколи');
  return new Date(iso).toLocaleString('uk-UA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function extractDomain(domains: string[]): string {
  const base = domains.find((d) => !d.startsWith('www.'));
  return base ?? domains[0] ?? '';
}

/** Visual step header: number badge + title + optional "done" indicator. */
function StepHeader({ n, title, done }: { n: number; title: string; done?: boolean }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span
        className="shrink-0 flex items-center justify-center text-xs font-semibold"
        style={{
          width: 20, height: 20, borderRadius: '50%',
          background: done ? 'rgba(34,197,94,0.12)' : 'var(--s3)',
          color: done ? 'var(--ok)' : 'var(--t3)',
          border: `1px solid ${done ? 'rgba(34,197,94,0.25)' : 'var(--br)'}`,
          fontFamily: 'var(--font-mono)',
        }}
      >
        {done ? '✓' : n}
      </span>
      <span className="text-xs font-semibold" style={{ color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {title}
      </span>
    </div>
  );
}

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://ownfleet.app';

export function TrackingWidgetSection({ initialApiKey, hostedTrackingEnabled }: Props) {
  const t = useT();
  const [apiKey, setApiKey] = useState<ApiKeyMeta | null>(initialApiKey);
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);
  const [domain, setDomain] = useState<string>(() =>
    initialApiKey ? extractDomain(initialApiKey.allowed_domains) : '',
  );

  const [isGenerating, setIsGenerating] = useState(false);
  const [isSavingDomain, setIsSavingDomain] = useState(false);
  const [domainSaved, setDomainSaved] = useState(false);
  const [isTogglingActive, setIsTogglingActive] = useState(false);

  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);

  const [error, setError] = useState('');
  const domainBlurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (domainBlurTimeout.current) clearTimeout(domainBlurTimeout.current);
    };
  }, []);

  // Use the full key when it was just generated (newKeyValue), otherwise show placeholder.
  // The key is only returned once by the API and cannot be retrieved later.
  const embedCode = apiKey
    ? `<script src="${BASE_URL}/tracker.js"\n  data-api-key="${newKeyValue ?? 'YOUR_FULL_API_KEY'}"\n  data-order-id="ORDER_ID"\n  data-lang="uk"></script>`
    : '';

  async function handleGenerateKey(): Promise<void> {
    setIsGenerating(true);
    setError('');
    try {
      const res = await apiPost<{ key: string; id: string; key_prefix: string }>(
        '/api/v1/establishments/api-key',
        { website_url: domain || undefined },
      );
      setNewKeyValue(res.key);
      // Refresh metadata (key is returned once, metadata via GET)
      const meta = await apiGet<ApiKeyMeta>('/api/v1/establishments/api-key');
      setApiKey(meta);
    } catch {
      setError(t('Не вдалось згенерувати ключ'));
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleDomainBlur(): Promise<void> {
    if (!apiKey) return;
    if (domain.trim() === extractDomain(apiKey.allowed_domains)) return;

    if (domainBlurTimeout.current) clearTimeout(domainBlurTimeout.current);
    domainBlurTimeout.current = setTimeout(async () => {
      if (!apiKey) return;
      setIsSavingDomain(true);
      setError('');
      try {
        await apiPatch(`/api/v1/establishments/api-key/${apiKey.id}/domains`, {
          website_url: domain,
        });
        setApiKey((prev) =>
          prev
            ? {
                ...prev,
                allowed_domains: domain ? expandDomains(domain) : prev.allowed_domains,
              }
            : prev,
        );
        setDomainSaved(true);
        setTimeout(() => setDomainSaved(false), 2000);
      } catch {
        setError(t('Не вдалось зберегти домен'));
      } finally {
        setIsSavingDomain(false);
      }
    }, 300);
  }

  async function handleToggleActive(): Promise<void> {
    if (!apiKey) return;
    // If key is active, require explicit confirmation before disabling
    if (apiKey.is_active && !confirmDisable) {
      setConfirmDisable(true);
      return;
    }
    setConfirmDisable(false);
    setIsTogglingActive(true);
    setError('');
    try {
      await apiPatch(`/api/v1/establishments/api-key/${apiKey.id}/toggle`, {});
      setApiKey((prev) => (prev ? { ...prev, is_active: !prev.is_active } : prev));
    } catch {
      setError(t('Не вдалось змінити статус ключа'));
    } finally {
      setIsTogglingActive(false);
    }
  }

  const domainDone = !!apiKey && apiKey.allowed_domains.length > 0;
  const keyDone = !!apiKey;

  return (
    <div
      className="rounded-md mb-4"
      style={{
        background: 'var(--s2)',
        border: '1px solid var(--br)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
      }}
    >
      {/* Header */}
      <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--br)' }}>
        <p className="text-sm font-semibold" style={{ color: 'var(--t1)' }}>
          {t('Підключення трекінгу на сайт')}
        </p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--t3)' }}>
          {t('Вставте код на ваш сайт — клієнти бачитимуть статус і місце знаходження курʼєра в реальному часі')}
        </p>
      </div>

      <div className="px-5 py-4 flex flex-col gap-5">

        {/* ── Step 1: Domain ── */}
        <div>
          <StepHeader n={1} title={t('Адреса вашого сайту')} done={domainDone} />

          {/* Before key generation */}
          {!apiKey && (
            <div className="flex flex-col gap-1.5">
              <input
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="pizza.com"
                className="text-sm rounded outline-none transition-all"
                style={{
                  background: 'var(--s1)', border: '1px solid var(--br)',
                  color: 'var(--t1)', padding: '7px 10px',
                }}
                onFocus={(e) => (e.currentTarget.style.boxShadow = '0 0 0 1px var(--bg), 0 0 0 2px rgba(250,249,246,0.25)')}
                onBlur={(e) => (e.currentTarget.style.boxShadow = 'none')}
              />
              <p className="text-xs" style={{ color: 'var(--t3)' }}>
                {t('Запити тільки з цього домену будуть прийняті')}
              </p>
            </div>
          )}

          {/* After key exists — editable domain */}
          {apiKey && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="pizza.com"
                  className="flex-1 text-sm rounded outline-none transition-all"
                  style={{
                    background: 'var(--s1)', border: '1px solid var(--br)',
                    color: 'var(--t1)', padding: '7px 10px',
                  }}
                  onFocus={(e) => (e.currentTarget.style.boxShadow = '0 0 0 1px var(--bg), 0 0 0 2px rgba(250,249,246,0.25)')}
                  onBlur={(e) => {
                    e.currentTarget.style.boxShadow = 'none';
                    handleDomainBlur();
                  }}
                />
                {isSavingDomain && (
                  <span className="text-xs" style={{ color: 'var(--t4)' }}>{t('Збереження…')}</span>
                )}
                {domainSaved && !isSavingDomain && (
                  <span className="text-xs" style={{ color: 'var(--ok)' }}>{t('Збережено')}</span>
                )}
              </div>
              {apiKey.allowed_domains.length > 0 && (
                <p className="text-xs" style={{ color: 'var(--t3)' }}>
                  {t('Дозволені домени:')} {apiKey.allowed_domains.join(', ')}
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── Step 2: API key ── */}
        <div>
          <StepHeader n={2} title={t('API-ключ')} done={keyDone} />

          {/* No key yet — generate button */}
          {!apiKey && (
            <button
              onClick={handleGenerateKey}
              disabled={isGenerating}
              className="self-start text-sm font-medium rounded transition-opacity disabled:opacity-50"
              style={{ background: 'var(--acm)', color: 'var(--t1)', padding: '6px 16px', borderRadius: '6px' }}
            >
              {isGenerating ? t('Генерується…') : t('Згенерувати API ключ')}
            </button>
          )}

          {/* Key just generated — show once */}
          {newKeyValue && (
            <div
              className="rounded-md p-3 flex flex-col gap-2 mb-3"
              style={{ background: 'var(--s1)', border: '1px solid var(--br2)' }}
            >
              <p className="text-xs font-medium" style={{ color: 'var(--t2)' }}>
                {t('Збережіть ключ — він більше не буде показаний')}
              </p>
              <div className="flex items-center gap-2">
                <code
                  className="text-xs flex-1 rounded px-2 py-1.5 select-all truncate"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    background: 'var(--s2)',
                    border: '1px solid var(--br)',
                    color: 'var(--t1)',
                  }}
                >
                  {newKeyValue}
                </code>
                <button
                  onClick={() => copyToClipboard(newKeyValue, () => { setCopiedKey(true); setTimeout(() => setCopiedKey(false), 2000); })}
                  className="shrink-0 text-xs font-medium rounded transition-all"
                  style={{
                    padding: '5px 10px', borderRadius: '6px',
                    background: copiedKey ? 'var(--acm)' : 'var(--s3)',
                    color: copiedKey ? 'var(--t1)' : 'var(--t3)',
                    border: '1px solid var(--br)',
                  }}
                >
                  {copiedKey ? t('Скопійовано') : t('Копіювати')}
                </button>
              </div>
            </div>
          )}

          {/* Key exists — status row */}
          {apiKey && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm" style={{ color: 'var(--t2)' }}>
                      <code className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--t3)' }}>
                        {apiKey.key_prefix}…
                      </code>
                    </p>
                    <span
                      className="text-xs font-medium"
                      style={{
                        padding: '1px 6px', borderRadius: '4px',
                        background: apiKey.is_active ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                        color: apiKey.is_active ? 'var(--ok)' : 'var(--bad)',
                        border: `1px solid ${apiKey.is_active ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
                      }}
                    >
                      {apiKey.is_active ? t('Активний') : t('Вимкнено')}
                    </span>
                  </div>
                  {apiKey.last_used_at ? (
                    <p className="text-xs mt-0.5" style={{ color: 'var(--t3)' }}>
                      {t('Остання активність:')} {formatDate(apiKey.last_used_at, t)}
                      {apiKey.last_used_domain && (
                        <> {t('з')} <span style={{ color: 'var(--t3)' }}>{apiKey.last_used_domain}</span></>
                      )}
                    </p>
                  ) : (
                    <p className="text-xs mt-0.5" style={{ color: 'var(--t3)' }}>{t('Ще не використовувався')}</p>
                  )}
                </div>
                <button
                  onClick={handleToggleActive}
                  disabled={isTogglingActive}
                  className="text-xs font-medium rounded transition-all disabled:opacity-40"
                  style={{
                    padding: '4px 10px', borderRadius: '6px',
                    background: apiKey.is_active ? 'rgba(239,68,68,0.1)' : 'var(--s3)',
                    color: apiKey.is_active ? 'var(--bad)' : 'var(--t3)',
                    border: `1px solid ${apiKey.is_active ? 'rgba(239,68,68,0.25)' : 'var(--br)'}`,
                  }}
                >
                  {apiKey.is_active ? t('Вимкнути API-ключ') : t('Увімкнути API-ключ')}
                </button>
              </div>

              {/* Confirm step before disabling */}
              {confirmDisable && (
                <div
                  className="rounded-md p-2.5 flex items-center justify-between gap-3"
                  style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)' }}
                >
                  <p className="text-xs" style={{ color: 'var(--t2)' }}>
                    {t('Віджет трекінгу перестане працювати для всіх нових запитів. Підтвердити?')}
                  </p>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => setConfirmDisable(false)}
                      className="text-xs font-medium rounded"
                      style={{ padding: '3px 10px', borderRadius: '6px', background: 'var(--s3)', color: 'var(--t3)', border: '1px solid var(--br)' }}
                    >
                      {t('Скасувати')}
                    </button>
                    <button
                      onClick={handleToggleActive}
                      disabled={isTogglingActive}
                      className="text-xs font-medium rounded disabled:opacity-40"
                      style={{ padding: '3px 10px', borderRadius: '6px', background: 'rgba(239,68,68,0.15)', color: 'var(--bad)', border: '1px solid rgba(239,68,68,0.3)' }}
                    >
                      {t('Вимкнути')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Step 3: Embed code — shown only when key exists ── */}
        {apiKey && (
          <div>
            <StepHeader n={3} title={t('Код для вставки')} />
            <div className="flex flex-col gap-1.5">
              <div
                className="rounded-md p-3 relative"
                style={{ background: 'var(--s1)', border: '1px solid var(--br)' }}
              >
                <pre
                  className="text-xs overflow-x-auto"
                  style={{ fontFamily: 'var(--font-mono)', color: 'var(--t2)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
                >
                  {embedCode}
                </pre>
                <button
                  onClick={() => copyToClipboard(embedCode, () => { setCopiedCode(true); setTimeout(() => setCopiedCode(false), 2000); })}
                  className="absolute top-2 right-2 text-xs font-medium rounded transition-all"
                  style={{
                    padding: '3px 8px', borderRadius: '4px',
                    background: copiedCode ? 'var(--acm)' : 'var(--s3)',
                    color: copiedCode ? 'var(--t1)' : 'var(--t3)',
                    border: '1px solid var(--br)',
                  }}
                >
                  {copiedCode ? '✓' : t('Копіювати')}
                </button>
              </div>
              {newKeyValue ? (
                <p className="text-xs" style={{ color: 'var(--t3)' }}>
                  {t('Вставте перед')} {'</body>'} {t('на сторінках з замовленнями. Замініть')}{' '}
                  <code style={{ fontFamily: 'var(--font-mono)' }}>ORDER_ID</code> {t('на номер замовлення з вашої CRM.')}
                </p>
              ) : (
                <p className="text-xs" style={{ color: 'var(--t3)' }}>
                  {t('Вставте перед')} {'</body>'} {t('на сторінках з замовленнями. Замініть')}{' '}
                  <code style={{ fontFamily: 'var(--font-mono)' }}>YOUR_FULL_API_KEY</code> {t('на повний ключ')}
                  {t('(показується лише раз при генерації) та')}{' '}
                  <code style={{ fontFamily: 'var(--font-mono)' }}>ORDER_ID</code> {t('на номер замовлення з вашої CRM.')}
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Step 4: Hosted tracking — only when hosted_tracking_enabled ── */}
        {apiKey && hostedTrackingEnabled && (
          <div>
            <StepHeader n={4} title={t('Hosted-сторінка трекінгу')} />
            <div
              className="rounded-md p-3 flex flex-col gap-1.5"
              style={{ background: 'var(--s1)', border: '1px solid var(--br)' }}
            >
              <p className="text-xs" style={{ color: 'var(--t3)' }}>
                {t('Альтернатива embed-коду — не потребує вставки на ваш сайт. Клієнт отримує пряме посилання на сторінку трекінгу.')}
              </p>
              <a
                href="/orders"
                className="self-start text-xs font-medium"
                style={{ color: 'var(--t2)', textDecoration: 'underline', textUnderlineOffset: '3px' }}
              >
                {t('Перейти до замовлень →')}
              </a>
            </div>
          </div>
        )}

        {error && (
          <p className="text-xs" style={{ color: 'var(--bad)' }}>{error}</p>
        )}
      </div>
    </div>
  );
}

/** Client-side domain expansion for optimistic UI (mirrors server logic). */
function expandDomains(websiteUrl: string): string[] {
  const host = websiteUrl.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0] ?? '';
  if (!host) return [];
  const domains = new Set<string>([host]);
  if (host.startsWith('www.')) {
    domains.add(host.slice(4));
  } else {
    domains.add(`www.${host}`);
  }
  return [...domains];
}
