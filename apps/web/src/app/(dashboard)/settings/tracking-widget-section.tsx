'use client';

/**
 * Tracking Widget Section — /settings
 *
 * Shows:
 * - Website URL field (auto-save on blur, auto-www expansion)
 * - Embed code snippet (copy button)
 * - Last activity timestamp
 * - API key status (active/inactive toggle)
 * - Conditional hosted page block (shown only when hosted_tracking_enabled = true)
 * - "Generate key" button when no key exists yet
 */

import { useState, useRef, useEffect } from 'react';
import { apiGet, apiPost, apiPatch } from '@/lib/api-client';
import { ApiKeyMeta } from '@/types';

interface Props {
  initialApiKey: ApiKeyMeta | null;
  hostedTrackingEnabled: boolean;
}

function copyToClipboard(text: string, onDone: () => void): void {
  navigator.clipboard.writeText(text).then(onDone).catch(() => {});
}

function formatDate(iso: string | null): string {
  if (!iso) return 'ніколи';
  return new Date(iso).toLocaleString('uk-UA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function extractDomain(domains: string[]): string {
  // Return the base domain (without www prefix) for display in the input
  const base = domains.find((d) => !d.startsWith('www.'));
  return base ?? domains[0] ?? '';
}

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://weego.app';

export function TrackingWidgetSection({ initialApiKey, hostedTrackingEnabled }: Props) {
  const [apiKey, setApiKey] = useState<ApiKeyMeta | null>(initialApiKey);
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);
  const [domain, setDomain] = useState<string>(() =>
    initialApiKey ? extractDomain(initialApiKey.allowed_domains) : '',
  );

  const [isGenerating, setIsGenerating] = useState(false);
  const [isSavingDomain, setIsSavingDomain] = useState(false);
  const [isTogglingActive, setIsTogglingActive] = useState(false);

  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  const [error, setError] = useState('');
  const domainBlurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (domainBlurTimeout.current) clearTimeout(domainBlurTimeout.current);
    };
  }, []);

  // Use the full key when it was just generated (newKeyValue), otherwise show placeholder
  // (the key is only returned once by the API and cannot be retrieved later).
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
      setError('Не вдалось згенерувати ключ');
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
                allowed_domains: domain
                  ? expandDomains(domain)
                  : prev.allowed_domains,
              }
            : prev,
        );
      } catch {
        setError('Не вдалось зберегти домен');
      } finally {
        setIsSavingDomain(false);
      }
    }, 300);
  }

  async function handleToggleActive(): Promise<void> {
    if (!apiKey) return;
    setIsTogglingActive(true);
    setError('');
    try {
      await apiPatch(`/api/v1/establishments/api-key/${apiKey.id}/toggle`, {});
      setApiKey((prev) => (prev ? { ...prev, is_active: !prev.is_active } : prev));
    } catch {
      setError('Не вдалось змінити статус ключа');
    } finally {
      setIsTogglingActive(false);
    }
  }

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
          Трекінг для клієнтів
        </p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--t4)' }}>
          Дозвольте клієнтам бачити де знаходиться їх замовлення в реальному часі
        </p>
      </div>

      <div className="px-5 py-4 flex flex-col gap-4">
        {/* No key yet */}
        {!apiKey && (
          <div className="flex flex-col gap-3">
            <p className="text-sm" style={{ color: 'var(--t3)' }}>
              Для підключення трекінгу потрібен API ключ. Він генерується один раз і
              вставляється у ваш сайт.
            </p>

            {/* Domain input before generation */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium" style={{ color: 'var(--t4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Адреса вашого сайту
              </label>
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
              <p className="text-xs" style={{ color: 'var(--t4)' }}>
                Запити тільки з цього домену будуть прийняті
              </p>
            </div>

            <button
              onClick={handleGenerateKey}
              disabled={isGenerating}
              className="self-start text-sm font-medium rounded transition-opacity disabled:opacity-50"
              style={{ background: 'var(--acm)', color: 'var(--t1)', padding: '6px 16px', borderRadius: '6px' }}
            >
              {isGenerating ? 'Генерується…' : 'Згенерувати API ключ'}
            </button>
          </div>
        )}

        {/* Key generated — show once */}
        {newKeyValue && (
          <div
            className="rounded-md p-3 flex flex-col gap-2"
            style={{ background: 'var(--s2)', border: '1px solid var(--br2)' }}
          >
            <p className="text-xs font-medium" style={{ color: 'var(--t2)' }}>
              Збережіть ключ — він більше не буде показаний
            </p>
            <div className="flex items-center gap-2">
              <code
                className="text-xs flex-1 rounded px-2 py-1.5 select-all truncate"
                style={{
                  fontFamily: 'var(--font-mono)',
                  background: 'var(--s1)',
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
                {copiedKey ? 'Скопійовано' : 'Копіювати'}
              </button>
            </div>
          </div>
        )}

        {/* Key exists — settings */}
        {apiKey && (
          <>
            {/* Domain field */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium" style={{ color: 'var(--t4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Адреса вашого сайту
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  onBlur={handleDomainBlur}
                  placeholder="pizza.com"
                  className="flex-1 text-sm rounded outline-none transition-all"
                  style={{
                    background: 'var(--s1)', border: '1px solid var(--br)',
                    color: 'var(--t1)', padding: '7px 10px',
                  }}
                  onFocus={(e) => (e.currentTarget.style.boxShadow = '0 0 0 1px var(--bg), 0 0 0 2px rgba(250,249,246,0.25)')}
                />
                {isSavingDomain && (
                  <span className="text-xs" style={{ color: 'var(--t4)' }}>Збереження…</span>
                )}
              </div>
              {apiKey.allowed_domains.length > 0 && (
                <p className="text-xs" style={{ color: 'var(--t4)' }}>
                  Дозволені домени: {apiKey.allowed_domains.join(', ')}
                </p>
              )}
            </div>

            {/* Embed code */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium" style={{ color: 'var(--t4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Код для вставки
              </label>
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
                  {copiedCode ? '✓' : 'Копіювати'}
                </button>
              </div>
              <p className="text-xs" style={{ color: 'var(--t4)' }}>
                Вставте перед {'</body>'} на сторінках з замовленнями. Замініть{' '}
                <code style={{ fontFamily: 'var(--font-mono)' }}>YOUR_FULL_API_KEY</code> на ваш повний
                ключ (показується лише раз при генерації) та{' '}
                <code style={{ fontFamily: 'var(--font-mono)' }}>ORDER_ID</code> на номер замовлення з вашої CRM.
              </p>
            </div>

            {/* Key status row */}
            <div className="flex items-center justify-between py-2 border-t" style={{ borderColor: 'var(--br)' }}>
              <div>
                <p className="text-sm" style={{ color: 'var(--t2)' }}>
                  Ключ{' '}
                  <code
                    className="text-xs"
                    style={{ fontFamily: 'var(--font-mono)', color: 'var(--t3)' }}
                  >
                    {apiKey.key_prefix}…
                  </code>
                </p>
                {apiKey.last_used_at && (
                  <p className="text-xs mt-0.5" style={{ color: 'var(--t4)' }}>
                    Остання активність: {formatDate(apiKey.last_used_at)}
                    {apiKey.last_used_domain && (
                      <> з <span style={{ color: 'var(--t3)' }}>{apiKey.last_used_domain}</span></>
                    )}
                  </p>
                )}
                {!apiKey.last_used_at && (
                  <p className="text-xs mt-0.5" style={{ color: 'var(--t4)' }}>
                    Ще не використовувався
                  </p>
                )}
              </div>
              <button
                onClick={handleToggleActive}
                disabled={isTogglingActive}
                className="text-xs font-medium rounded transition-all disabled:opacity-40"
                style={{
                  padding: '4px 10px', borderRadius: '6px',
                  background: apiKey.is_active ? 'rgba(239,68,68,0.1)' : 'var(--s2)',
                  color: apiKey.is_active ? 'var(--bad)' : 'var(--t3)',
                  border: `1px solid ${apiKey.is_active ? 'rgba(239,68,68,0.25)' : 'var(--br)'}`,
                }}
              >
                {apiKey.is_active ? 'Вимкнути' : 'Увімкнути'}
              </button>
            </div>

            {/* Hosted page — only when hosted_tracking_enabled */}
            {hostedTrackingEnabled && (
              <div
                className="rounded-md p-3 flex flex-col gap-1.5"
                style={{ background: 'var(--s2)', border: '1px solid var(--br)' }}
              >
                <p className="text-xs font-semibold" style={{ color: 'var(--t2)' }}>
                  Hosted tracking page
                </p>
                <p className="text-xs" style={{ color: 'var(--t4)' }}>
                  Пряме посилання для клієнта — не потребує вставки коду на ваш сайт.
                  Копіюйте посилання з таблиці замовлень.
                </p>
              </div>
            )}
          </>
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
  let host = websiteUrl.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0] ?? '';
  if (!host) return [];
  const domains = new Set<string>([host]);
  if (host.startsWith('www.')) {
    domains.add(host.slice(4));
  } else {
    domains.add(`www.${host}`);
  }
  return [...domains];
}
