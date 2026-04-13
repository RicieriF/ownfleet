'use client';

import { useState, useTransition } from 'react';
import { apiPost, apiPatch, apiDelete } from '@/lib/api-client';

interface Integration {
  id: string;
  type: 'poster' | 'iiko';
  active: boolean;
  config: Record<string, string>;
  updated_at: string;
}

// ── Field definitions per integration type ──────────────────────────────────

const INTEGRATION_META = {
  poster: {
    label: 'Poster POS',
    description: 'Автоматичний імпорт замовлень через webhook від Poster.',
    fields: [
      { key: 'api_token',      label: 'API Token',        placeholder: 'poster-api-token', secret: true },
      { key: 'restaurant_id',  label: 'Restaurant ID',    placeholder: '12345',            secret: false },
      { key: 'hmac_secret',    label: 'HMAC Secret',      placeholder: 'webhook-secret',   secret: true },
    ],
  },
  iiko: {
    label: 'iiko',
    description: 'Опитування замовлень кожні 2 хвилини через iiko API.',
    fields: [
      { key: 'server_url',       label: 'Server URL',       placeholder: 'http://iiko-server:8080', secret: false },
      { key: 'login',            label: 'Логін',            placeholder: 'admin',                   secret: false },
      { key: 'password',         label: 'Пароль',           placeholder: '••••••••',                secret: true },
      { key: 'organization_id',  label: 'Organization ID',  placeholder: 'uuid',                    secret: false },
    ],
  },
} as const;

type IntegrationType = keyof typeof INTEGRATION_META;

// ── Single integration card ──────────────────────────────────────────────────

function IntegrationCard({
  type,
  existing,
  onSaved,
  onDeleted,
}: {
  type: IntegrationType;
  existing: Integration | undefined;
  onSaved: (i: Integration) => void;
  onDeleted: (id: string) => void;
}) {
  const meta = INTEGRATION_META[type];
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>(
    () => existing?.config ?? {},
  );
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function setField(key: string, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    setError('');
    startTransition(async () => {
      try {
        const result = await apiPost<Integration>('/api/v1/integrations', {
          type,
          config: fields,
          active: true,
        });
        onSaved(result);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Помилка збереження');
      }
    });
  }

  function handleToggle() {
    if (!existing) return;
    startTransition(async () => {
      try {
        const result = await apiPatch<Integration>(`/api/v1/integrations/${existing.id}`, {
          active: !existing.active,
        });
        onSaved(result);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Помилка');
      }
    });
  }

  function handleDelete() {
    if (!existing) return;
    startTransition(async () => {
      try {
        await apiDelete(`/api/v1/integrations/${existing.id}`);
        onDeleted(existing.id);
        setFields({});
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Помилка видалення');
      }
    });
  }

  return (
    <div
      className="rounded-lg"
      style={{
        background: 'var(--s2)',
        border: existing ? '1px solid var(--acm-b)' : '1px solid var(--br)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
      }}
    >
      {/* Header row */}
      <div className="px-5 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div
            className="w-2 h-2 rounded-full"
            style={{
              background: existing?.active ? 'var(--ok)' : existing ? 'var(--t4)' : 'var(--br)',
              boxShadow: existing?.active ? '0 0 6px var(--ok)' : 'none',
            }}
          />
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--t1)' }}>{meta.label}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--t3)' }}>{meta.description}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {existing && (
            <button
              onClick={handleToggle}
              disabled={isPending}
              className="text-xs px-2.5 py-1 rounded font-medium disabled:opacity-40"
              style={{
                border: existing.active ? '1px solid var(--acm-b)' : '1px solid var(--br)',
                background: existing.active ? 'var(--acm-m)' : 'var(--s1)',
                color: existing.active ? 'var(--t2)' : 'var(--t4)',
                borderRadius: '6px',
              }}
            >
              {existing.active ? 'Активна' : 'Вимкнено'}
            </button>
          )}
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-xs px-3 py-1.5 rounded"
            style={{
              background: 'var(--s1)',
              border: '1px solid var(--br)',
              color: 'var(--t3)',
              borderRadius: '6px',
            }}
          >
            {existing ? 'Налаштувати' : 'Підключити'}
          </button>
        </div>
      </div>

      {/* Config form */}
      {open && (
        <div className="px-5 pb-5 border-t space-y-3" style={{ borderColor: 'var(--br)', paddingTop: '16px' }}>
          {meta.fields.map((f) => (
            <div key={f.key}>
              <label
                className="block mb-1"
                style={{ color: 'var(--t4)', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}
              >
                {f.label}
              </label>
              <input
                type={f.secret ? 'password' : 'text'}
                value={fields[f.key] ?? ''}
                onChange={(e) => setField(f.key, e.target.value)}
                placeholder={f.placeholder}
                autoComplete="off"
                className="w-full text-sm rounded outline-none"
                style={{
                  fontFamily: f.key.includes('token') || f.key.includes('secret') || f.key === 'password'
                    ? 'var(--font-mono)' : undefined,
                  background: 'var(--s1)',
                  border: '1px solid var(--br)',
                  color: 'var(--t1)',
                  padding: '6px 10px',
                  borderRadius: '6px',
                }}
                onFocus={(e) => (e.currentTarget.style.boxShadow = '0 0 0 1px var(--bg), 0 0 0 2px rgba(250,249,246,0.25)')}
                onBlur={(e) => (e.currentTarget.style.boxShadow = 'none')}
              />
            </div>
          ))}

          {error && <p className="text-xs" style={{ color: 'var(--bad)' }}>{error}</p>}
          {saved && <p className="text-xs" style={{ color: 'var(--t3)' }}>Збережено</p>}

          <div className="flex items-center justify-between pt-1">
            <div className="flex gap-3">
              <button
                onClick={handleSave}
                disabled={isPending}
                className="text-sm font-medium rounded disabled:opacity-40"
                style={{ background: 'var(--acm)', color: 'var(--t1)', padding: '6px 16px', borderRadius: '6px' }}
              >
                {isPending ? 'Зберігаємо…' : 'Зберегти'}
              </button>
              <button onClick={() => setOpen(false)} className="text-sm" style={{ color: 'var(--t3)' }}>
                Скасувати
              </button>
            </div>
            {existing && (
              <button
                onClick={handleDelete}
                disabled={isPending}
                className="text-xs px-2.5 py-1 rounded disabled:opacity-40"
                style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: 'var(--bad)', borderRadius: '6px' }}
              >
                Відключити
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function IntegrationsManager({ initialIntegrations }: { initialIntegrations: Integration[] }) {
  const [integrations, setIntegrations] = useState<Integration[]>(initialIntegrations);

  function findByType(type: IntegrationType) {
    return integrations.find((i) => i.type === type);
  }

  function handleSaved(updated: Integration) {
    setIntegrations((prev) => {
      const idx = prev.findIndex((i) => i.id === updated.id || i.type === updated.type);
      if (idx >= 0) return prev.map((i, n) => (n === idx ? updated : i));
      return [...prev, updated];
    });
  }

  function handleDeleted(id: string) {
    setIntegrations((prev) => prev.filter((i) => i.id !== id));
  }

  return (
    <div className="space-y-3">
      {(['poster', 'iiko'] as const).map((type) => (
        <IntegrationCard
          key={type}
          type={type}
          existing={findByType(type)}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      ))}
    </div>
  );
}
