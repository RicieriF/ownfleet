'use client';

import { useState, useTransition } from 'react';
import { Webhook } from '@/types';
import { apiPost, apiPatch, apiDelete } from '@/lib/api-client';
import { formatDistanceToNow } from 'date-fns';
import { uk } from 'date-fns/locale';

const ALL_EVENTS = [
  'order.created',
  'order.assigned',
  'order.cancelled',
  'delivery.started',
  'delivery.completed',
  'delivery.failed',
] as const;

// ── Create form ─────────────────────────────────────────────────────────────

function CreateWebhookForm({ onCreated }: { onCreated: (w: Webhook) => void }) {
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [events, setEvents] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  function toggleEvent(e: string) {
    setEvents((prev) => (prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]));
  }

  function handleSubmit() {
    if (!url || !secret || events.length === 0) {
      setError('URL, секрет та хоча б одна подія обовʼязкові');
      return;
    }
    setError('');
    startTransition(async () => {
      try {
        const webhook = await apiPost<Webhook>('/api/v1/webhooks', { url, secret, events });
        onCreated(webhook);
        setUrl(''); setSecret(''); setEvents([]); setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Помилка створення');
      }
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-sm font-medium rounded"
        style={{ background: '#6aaa84', color: '#09090b', padding: '6px 16px', borderRadius: '6px' }}
      >
        + Додати webhook
      </button>
    );
  }

  return (
    <div
      className="rounded-lg mb-4 p-5"
      style={{ background: 'var(--s2)', border: '1px solid var(--acm-b)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)' }}
    >
      <p className="text-sm font-semibold mb-4" style={{ color: 'var(--t1)' }}>Новий webhook</p>

      <div className="space-y-3">
        {/* URL */}
        <div>
          <label className="block mb-1" style={{ color: 'var(--t4)', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            URL
          </label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://your-app.com/webhooks"
            className="w-full text-sm rounded outline-none"
            style={{ background: 'var(--s1)', border: '1px solid var(--br)', color: 'var(--t1)', padding: '6px 10px', borderRadius: '6px' }}
            onFocus={(e) => (e.currentTarget.style.boxShadow = '0 0 0 1px var(--bg), 0 0 0 3px #6aaa84')}
            onBlur={(e) => (e.currentTarget.style.boxShadow = 'none')}
          />
        </div>

        {/* Secret */}
        <div>
          <label className="block mb-1" style={{ color: 'var(--t4)', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            HMAC Secret
          </label>
          <input
            type="text"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="your-hmac-secret"
            className="w-full text-sm rounded outline-none"
            style={{ fontFamily: 'var(--font-mono)', background: 'var(--s1)', border: '1px solid var(--br)', color: 'var(--t1)', padding: '6px 10px', borderRadius: '6px' }}
            onFocus={(e) => (e.currentTarget.style.boxShadow = '0 0 0 1px var(--bg), 0 0 0 3px #6aaa84')}
            onBlur={(e) => (e.currentTarget.style.boxShadow = 'none')}
          />
        </div>

        {/* Events */}
        <div>
          <label className="block mb-2" style={{ color: 'var(--t4)', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Події
          </label>
          <div className="flex flex-wrap gap-2">
            {ALL_EVENTS.map((ev) => (
              <button
                key={ev}
                type="button"
                onClick={() => toggleEvent(ev)}
                className="text-xs px-2.5 py-1 rounded font-medium transition-colors"
                style={{
                  borderRadius: '4px',
                  border: events.includes(ev) ? '1px solid var(--acm-b)' : '1px solid var(--br)',
                  background: events.includes(ev) ? 'var(--acm-m)' : 'var(--s1)',
                  color: events.includes(ev) ? 'var(--acm)' : 'var(--t3)',
                }}
              >
                {ev}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <p className="text-xs mt-3" style={{ color: 'var(--bad)' }}>{error}</p>}

      <div className="flex gap-3 mt-4">
        <button
          onClick={handleSubmit}
          disabled={isPending}
          className="text-sm font-medium rounded disabled:opacity-40"
          style={{ background: '#6aaa84', color: '#09090b', padding: '6px 16px', borderRadius: '6px' }}
        >
          {isPending ? 'Зберігаємо…' : 'Зберегти'}
        </button>
        <button
          onClick={() => { setOpen(false); setError(''); }}
          className="text-sm"
          style={{ color: 'var(--t4)' }}
        >
          Скасувати
        </button>
      </div>
    </div>
  );
}

// ── Webhook row ─────────────────────────────────────────────────────────────

function WebhookRow({ webhook, onToggle, onDelete }: {
  webhook: Webhook;
  onToggle: (id: string, active: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
      {/* URL + events */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: 'var(--t1)', fontFamily: 'var(--font-mono)' }}>
          {webhook.url}
        </p>
        <div className="flex flex-wrap gap-1 mt-1.5">
          {webhook.events.map((ev) => (
            <span
              key={ev}
              className="text-xs px-1.5 py-0.5 rounded"
              style={{ background: 'var(--s1)', border: '1px solid var(--br)', color: 'var(--t4)', borderRadius: '3px' }}
            >
              {ev}
            </span>
          ))}
        </div>
        {webhook.consecutive_failures > 0 && (
          <p className="text-xs mt-1" style={{ color: 'var(--bad)' }}>
            {webhook.consecutive_failures} невдалих спроб
            {webhook.last_error && ` · ${webhook.last_error}`}
          </p>
        )}
      </div>

      {/* Last error time */}
      {webhook.last_error_at && (
        <span className="text-xs hidden lg:block shrink-0" style={{ color: 'var(--t4)' }}>
          {formatDistanceToNow(new Date(webhook.last_error_at), { locale: uk, addSuffix: true })}
        </span>
      )}

      {/* Active toggle */}
      <button
        onClick={() => startTransition(async () => {
          await apiPatch(`/api/v1/webhooks/${webhook.id}`, { active: !webhook.active }).catch(() => {});
          onToggle(webhook.id, !webhook.active);
        })}
        disabled={isPending}
        className="shrink-0 text-xs px-2.5 py-1 rounded font-medium disabled:opacity-40"
        style={{
          border: webhook.active ? '1px solid var(--acm-b)' : '1px solid var(--br)',
          background: webhook.active ? 'var(--acm-m)' : 'var(--s1)',
          color: webhook.active ? 'var(--acm)' : 'var(--t4)',
          borderRadius: '4px',
        }}
      >
        {webhook.active ? 'Активний' : 'Вимкнено'}
      </button>

      {/* Delete */}
      <button
        onClick={() => startTransition(async () => {
          await apiDelete(`/api/v1/webhooks/${webhook.id}`).catch(() => {});
          onDelete(webhook.id);
        })}
        disabled={isPending}
        className="shrink-0 text-xs px-2 py-1 rounded disabled:opacity-40"
        style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: 'var(--bad)', borderRadius: '4px' }}
      >
        Видалити
      </button>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function WebhooksManager({ initialWebhooks }: { initialWebhooks: Webhook[] }) {
  const [webhooks, setWebhooks] = useState<Webhook[]>(initialWebhooks);

  function handleCreated(w: Webhook) {
    setWebhooks((prev) => [w, ...prev]);
  }

  function handleToggle(id: string, active: boolean) {
    setWebhooks((prev) => prev.map((w) => (w.id === id ? { ...w, active } : w)));
  }

  function handleDelete(id: string) {
    setWebhooks((prev) => prev.filter((w) => w.id !== id));
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <CreateWebhookForm onCreated={handleCreated} />
      </div>

      {webhooks.length === 0 ? (
        <div
          className="rounded-lg px-5 py-8 text-center text-sm"
          style={{ background: 'var(--s2)', border: '1px solid var(--br)', color: 'var(--t4)' }}
        >
          Немає налаштованих webhooks
        </div>
      ) : (
        <div
          className="rounded-lg divide-y"
          style={{ background: 'var(--s2)', border: '1px solid var(--br)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)', borderColor: 'var(--br)' }}
        >
          {webhooks.map((w) => (
            <WebhookRow
              key={w.id}
              webhook={w}
              onToggle={handleToggle}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
