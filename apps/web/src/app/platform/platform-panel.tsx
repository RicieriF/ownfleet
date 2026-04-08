'use client';

import { useState, useTransition } from 'react';
import { Plus, RefreshCw, Copy, Check, ChevronRight } from 'lucide-react';
import { apiPost, apiPatch } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type { TenantRow } from './page';

// ── Types ──────────────────────────────────────────────────────────────────

interface Credentials {
  owner:   { email: string; password: string };
  manager: { email: string; password: string };
}

interface CreateResult {
  establishment: { id: string; name: string; slug: string; trial_ends_at: string; plan: string };
  credentials: Credentials;
}

// ── Status badge ──────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  trial:   { label: 'Тріал',      color: 'text-[var(--warn)]  bg-[rgba(245,158,11,0.1)]  border-[rgba(245,158,11,0.2)]' },
  active:  { label: 'Активний',   color: 'text-[var(--t2)]    bg-[var(--acm-m)]           border-[var(--acm-b)]' },
  grace:   { label: 'Grace',      color: 'text-[var(--warn)]  bg-[rgba(245,158,11,0.08)] border-[rgba(245,158,11,0.15)]' },
  expired: { label: 'Прострочено',color: 'text-[var(--bad)]   bg-[rgba(239,68,68,0.1)]   border-[rgba(239,68,68,0.2)]' },
} as const;

function StatusBadge({ status }: { status: TenantRow['access_status'] }) {
  const { label, color } = STATUS_CONFIG[status];
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-[0.05em] border', color)}>
      {label}
    </span>
  );
}

// ── Copy button ───────────────────────────────────────────────────────────

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API fails on HTTP, unfocused tabs, or browser restrictions
      setFailed(true);
      setTimeout(() => setFailed(false), 2000);
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="ml-1.5 p-1 rounded text-[var(--t4)] hover:text-[var(--t2)] hover:bg-[var(--s2)] transition-colors"
      title={failed ? 'Не вдалось скопіювати' : 'Копіювати'}
    >
      {copied ? <Check size={12} className="text-[var(--ok)]" /> : <Copy size={12} className={failed ? 'text-[var(--bad)]' : ''} />}
    </button>
  );
}

// ── Credentials display (shown once after creation) ───────────────────────

function CredentialsCard({ creds }: { creds: Credentials }) {
  return (
    <div className="mt-4 rounded-md border border-[var(--acm-b)] bg-[var(--acm-m)] p-4 space-y-3">
      <p className="text-xs font-semibold text-[var(--t3)] uppercase tracking-[0.05em]">
        Credentials — скопіюйте зараз, більше не будуть показані
      </p>
      {(['owner', 'manager'] as const).map((role) => (
        <div key={role} className="space-y-1">
          <p className="text-[11px] uppercase tracking-[0.05em] text-[var(--t4)] font-semibold">{role}</p>
          <div className="flex items-center gap-1 font-mono text-sm text-[var(--t2)]">
            <span>{creds[role].email}</span>
            <CopyButton value={creds[role].email} />
          </div>
          <div className="flex items-center gap-1 font-mono text-sm text-[var(--t1)]">
            <span>{creds[role].password}</span>
            <CopyButton value={creds[role].password} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Create modal ──────────────────────────────────────────────────────────

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (t: TenantRow) => void }) {
  const [name, setName]         = useState('');
  const [slug, setSlug]         = useState('');
  const [trialDays, setTrialDays] = useState('14');
  const [error, setError]       = useState('');
  const [isPending, startTransition] = useTransition();
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [createdName, setCreatedName] = useState('');

  function handleNameChange(v: string) {
    setName(v);
    // Auto-generate slug from name
    if (!slug || slug === autoSlug(name)) {
      setSlug(autoSlug(v));
    }
  }

  function autoSlug(n: string) {
    return n.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40);
  }

  const slugIsAutoEmpty = !slug && name.trim().length > 0 && autoSlug(name.trim()) === '';

  function handleSubmit() {
    setError('');
    startTransition(async () => {
      try {
        const days = parseInt(trialDays, 10);
        const result = await apiPost<CreateResult>('/api/v1/platform/establishments', {
          name: name.trim(),
          slug: slug.trim(),
          trial_days: isNaN(days) ? 14 : days,
        });
        setCredentials(result.credentials);
        setCreatedName(result.establishment.name);
        // Build a minimal TenantRow for optimistic update
        onCreated({
          id: result.establishment.id,
          name: result.establishment.name,
          slug: result.establishment.slug,
          plan: result.establishment.plan,
          trial_ends_at: result.establishment.trial_ends_at,
          paid_until: null,
          onboarding_status: 'pending',
          created_at: new Date().toISOString(),
          couriers_count: 0,
          orders_total: 0,
          orders_last_30d: 0,
          access_status: 'trial',
          overdue_days: null,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Помилка';
        setError(msg.includes('409') ? `Slug "${slug}" вже зайнятий` : msg);
      }
    });
  }

  // After credentials shown — just close
  if (credentials) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div className="w-full max-w-md bg-[var(--sf)] rounded-lg border border-[var(--br2)] shadow-[var(--shadow-lg)] p-6">
          <div className="flex items-center gap-2 mb-1">
            <Check size={16} className="text-[var(--ok)]" />
            <h2 className="text-base font-semibold text-[var(--t1)]">{createdName} створено</h2>
          </div>
          <CredentialsCard creds={credentials} />
          <button
            onClick={onClose}
            className="mt-5 w-full py-2.5 rounded-md bg-[var(--acm)] hover:bg-[var(--acm-h)] text-[var(--t1)] text-sm font-semibold transition-colors"
          >
            Готово
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md bg-[var(--sf)] rounded-lg border border-[var(--br2)] shadow-[var(--shadow-lg)] p-6">
        <h2 className="text-base font-semibold text-[var(--t1)] mb-5">Новий заклад</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[var(--t3)] mb-1.5 uppercase tracking-[0.05em]">Назва</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Pizza Roma"
              className="w-full bg-[var(--bg)] border border-[var(--br2)] rounded-md px-3 py-2 text-sm text-[var(--t1)] placeholder:text-[var(--t4)] focus:outline-none focus:border-[rgba(250,249,246,0.25)] transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--t3)] mb-1.5 uppercase tracking-[0.05em]">Slug</label>
            <div className="flex items-center gap-0">
              <span className="px-3 py-2 bg-[var(--s2)] border border-r-0 border-[var(--br2)] rounded-l-md text-xs text-[var(--t4)] font-mono select-none">
                owner-
              </span>
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="pizza-roma"
                className="flex-1 bg-[var(--bg)] border border-[var(--br2)] rounded-r-md px-3 py-2 text-sm text-[var(--t1)] font-mono placeholder:text-[var(--t4)] focus:outline-none focus:border-[rgba(250,249,246,0.25)] transition-colors"
              />
            </div>
            <p className="mt-1 text-[11px] text-[var(--t4)]">
              Логін: owner-{slug || '…'}@weego.app
            </p>
            {slugIsAutoEmpty && (
              <p className="mt-1 text-[11px] text-[var(--warn)]">
                Назва містить тільки кирилицю — введіть slug вручну (латиниця, цифри, дефіс)
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--t3)] mb-1.5 uppercase tracking-[0.05em]">Тріал (днів)</label>
            <input
              type="number"
              min={1}
              max={365}
              value={trialDays}
              onChange={(e) => setTrialDays(e.target.value)}
              className="w-24 bg-[var(--bg)] border border-[var(--br2)] rounded-md px-3 py-2 text-sm text-[var(--t1)] font-mono focus:outline-none focus:border-[rgba(250,249,246,0.25)] transition-colors"
            />
          </div>
        </div>

        {error && (
          <p className="mt-3 text-xs text-[var(--bad)] bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.2)] rounded px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-md border border-[var(--br2)] text-sm text-[var(--t3)] hover:bg-[var(--s2)] transition-colors"
          >
            Скасувати
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending || !name.trim() || !slug.trim()}
            className="flex-1 py-2.5 rounded-md bg-[var(--acm)] hover:bg-[var(--acm-h)] disabled:opacity-50 text-[var(--t1)] text-sm font-semibold transition-colors"
          >
            {isPending ? 'Створення…' : 'Створити'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Extend modal ──────────────────────────────────────────────────────────

function ExtendModal({ tenant, onClose, onExtended }: {
  tenant: TenantRow;
  onClose: () => void;
  onExtended: (paid_until: string, access_status: TenantRow['access_status']) => void;
}) {
  const [days, setDays]     = useState('30');
  const [error, setError]   = useState('');
  const [isPending, startTransition] = useTransition();

  const now = new Date();
  const base = tenant.paid_until && new Date(tenant.paid_until) > now
    ? new Date(tenant.paid_until)
    : now;
  const preview = new Date(base.getTime() + (parseInt(days, 10) || 30) * 24 * 60 * 60 * 1000);

  function handleExtend() {
    const d = parseInt(days, 10);
    if (!d || d < 1 || d > 365) { setError('Введіть від 1 до 365 днів'); return; }
    setError('');
    startTransition(async () => {
      try {
        const result = await apiPatch<{ paid_until: string; access_status: TenantRow['access_status'] }>(
          `/api/v1/platform/establishments/${tenant.id}/subscription`,
          { days: d },
        );
        onExtended(result.paid_until, result.access_status);
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Помилка');
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm bg-[var(--sf)] rounded-lg border border-[var(--br2)] shadow-[var(--shadow-lg)] p-6">
        <h2 className="text-base font-semibold text-[var(--t1)] mb-1">Продовжити підписку</h2>
        <p className="text-sm text-[var(--t3)] mb-5">{tenant.name}</p>

        {tenant.overdue_days !== null && tenant.overdue_days > 0 && (
          <div className="mb-4 px-3 py-2 rounded border border-[rgba(239,68,68,0.2)] bg-[rgba(239,68,68,0.08)] text-xs text-[var(--bad)]">
            Прострочено {tenant.overdue_days} {pluralDays(tenant.overdue_days)}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[var(--t3)] mb-1.5 uppercase tracking-[0.05em]">Кількість днів</label>
            <div className="flex items-center gap-2">
              {[30, 60, 90].map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(String(d))}
                  className={cn(
                    'px-3 py-1.5 rounded border text-sm font-medium transition-colors',
                    days === String(d)
                      ? 'border-[var(--acm-b)] bg-[var(--acm-m)] text-[var(--t2)]'
                      : 'border-[var(--br2)] text-[var(--t3)] hover:bg-[var(--s2)]',
                  )}
                >
                  +{d}
                </button>
              ))}
              <input
                type="number"
                min={1}
                max={365}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                className="w-20 bg-[var(--bg)] border border-[var(--br2)] rounded-md px-2 py-1.5 text-sm text-[var(--t1)] font-mono focus:outline-none focus:border-[rgba(250,249,246,0.25)] transition-colors text-center"
              />
            </div>
          </div>

          <div className="px-3 py-2.5 rounded bg-[var(--s2)] border border-[var(--br)]">
            <p className="text-xs text-[var(--t4)] mb-0.5">Підписка до</p>
            <p className="text-sm font-mono text-[var(--t1)]">
              {preview.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
        </div>

        {error && (
          <p className="mt-3 text-xs text-[var(--bad)]">{error}</p>
        )}

        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-md border border-[var(--br2)] text-sm text-[var(--t3)] hover:bg-[var(--s2)] transition-colors">
            Скасувати
          </button>
          <button
            onClick={handleExtend}
            disabled={isPending}
            className="flex-1 py-2.5 rounded-md bg-[var(--acm)] hover:bg-[var(--acm-h)] disabled:opacity-50 text-[var(--t1)] text-sm font-semibold transition-colors"
          >
            {isPending ? 'Збереження…' : 'Продовжити'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────

export function PlatformPanel({ initialTenants }: { initialTenants: TenantRow[] }) {
  const [tenants, setTenants]         = useState<TenantRow[]>(initialTenants);
  const [showCreate, setShowCreate]   = useState(false);
  const [extending, setExtending]     = useState<TenantRow | null>(null);

  function handleCreated(t: TenantRow) {
    setTenants((prev) => [t, ...prev]);
  }

  function handleExtended(id: string, paid_until: string, access_status: TenantRow['access_status']) {
    setTenants((prev) => prev.map((t) =>
      t.id === id
        ? { ...t, paid_until, access_status, overdue_days: null }
        : t,
    ));
  }

  const active  = tenants.filter((t) => t.access_status === 'active').length;
  const trial   = tenants.filter((t) => t.access_status === 'trial').length;
  const grace   = tenants.filter((t) => t.access_status === 'grace').length;
  const expired = tenants.filter((t) => t.access_status === 'expired').length;

  return (
    <>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[var(--t1)] tracking-tight">Заклади</h1>
          <p className="mt-1 text-sm text-[var(--t4)] font-mono">
            {tenants.length} всього · {active} активних · {trial} тріал{grace > 0 ? ` · ${grace} grace` : ''} · {expired} прострочених
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-md bg-[var(--acm)] hover:bg-[var(--acm-h)] text-[var(--t1)] text-sm font-semibold transition-colors"
        >
          <Plus size={15} strokeWidth={2.5} />
          Новий заклад
        </button>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-[var(--br)] overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--br)] bg-[var(--sf)]">
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--t4)]">Заклад</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--t4)]">Статус</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--t4)]">Діє до</th>
              <th className="px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--t4)]">Курʼєри</th>
              <th className="px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--t4)]">Замовлення</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--t4)]">Дія</th>
            </tr>
          </thead>
          <tbody>
            {tenants.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm text-[var(--t4)]">
                  Закладів ще немає — створіть перший
                </td>
              </tr>
            )}
            {tenants.map((t, i) => (
              <tr
                key={t.id}
                className={cn(
                  'border-b border-[var(--br)] transition-colors hover:bg-[var(--s2)]',
                  i === tenants.length - 1 && 'border-0',
                )}
              >
                {/* Name */}
                <td className="px-4 py-2.5">
                  <p className="text-sm font-medium text-[var(--t1)]">{t.name}</p>
                  <p className="text-xs text-[var(--t4)] font-mono mt-0.5">
                    {new Date(t.created_at).toLocaleDateString('uk-UA')}
                  </p>
                </td>

                {/* Status */}
                <td className="px-4 py-2.5">
                  <div className="flex flex-col gap-1">
                    <StatusBadge status={t.access_status} />
                    {t.overdue_days !== null && t.overdue_days > 0 && (
                      <span className="text-[11px] text-[var(--bad)] font-mono">
                        -{t.overdue_days} {pluralDays(t.overdue_days)}
                      </span>
                    )}
                  </div>
                </td>

                {/* Expires */}
                <td className="px-4 py-2.5">
                  {t.paid_until ? (
                    <span className="text-sm font-mono text-[var(--t2)]">
                      {new Date(t.paid_until).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                  ) : t.trial_ends_at ? (
                    <span className="text-sm font-mono text-[var(--t3)]">
                      тріал до {new Date(t.trial_ends_at).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })}
                    </span>
                  ) : (
                    <span className="text-sm text-[var(--t4)]">—</span>
                  )}
                </td>

                {/* Couriers */}
                <td className="px-4 py-2.5 text-center">
                  <span className="text-sm font-mono text-[var(--t2)]">{t.couriers_count}</span>
                </td>

                {/* Orders */}
                <td className="px-4 py-2.5 text-center">
                  <span className="text-sm font-mono text-[var(--t2)]">{t.orders_last_30d}</span>
                  <span className="text-xs font-mono text-[var(--t4)] ml-1">/ {t.orders_total}</span>
                </td>

                {/* Action */}
                <td className="px-4 py-2.5 text-right">
                  <button
                    onClick={() => setExtending(t)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--br2)] text-xs text-[var(--t3)] hover:bg-[var(--s2)] hover:text-[var(--t1)] transition-colors"
                  >
                    <RefreshCw size={11} strokeWidth={2} />
                    Підписка
                    <ChevronRight size={11} strokeWidth={2} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modals */}
      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
      {extending && (
        <ExtendModal
          tenant={extending}
          onClose={() => setExtending(null)}
          onExtended={(paid_until, access_status) => handleExtended(extending.id, paid_until, access_status)}
        />
      )}
    </>
  );
}

// ── Utils ─────────────────────────────────────────────────────────────────

function pluralDays(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return 'день';
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'дні';
  return 'днів';
}
