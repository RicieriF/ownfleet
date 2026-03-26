import { apiFetch } from '@/lib/api';
import { Establishment } from '@/types';
import { SettingsForm } from './settings-form';
import { TelegramSettings } from './telegram-settings';

const PLAN_LABELS: Record<string, string> = {
  pilot:    'Pilot',
  trial:    'Trial',
  starter:  'Starter',
  business: 'Business',
  pro:      'Pro',
};

const PLAN_COLORS: Record<string, string> = {
  pilot:    'bg-[var(--s1)] text-[var(--t4)] border border-[var(--br)]',
  trial:    'bg-[rgba(245,158,11,0.12)] text-[var(--warn)] border border-[rgba(245,158,11,0.25)]',
  starter:  'bg-[var(--acm-m)] text-[var(--acm)] border border-[var(--acm-b)]',
  business: 'bg-[var(--acm-m)] text-[var(--acm)] border border-[var(--acm-b)]',
  pro:      'bg-[var(--acm-m)] text-[var(--acm)] border border-[var(--acm-b)]',
};

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-sm" style={{ color: 'var(--t4)', textTransform: 'uppercase', fontSize: '11px', fontWeight: 600, letterSpacing: '0.05em' }}>
        {label}
      </span>
      <span className="text-sm" style={{ color: 'var(--t2)' }}>{children}</span>
    </div>
  );
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
}

function billingStatus(est: Establishment): React.ReactNode {
  const now = Date.now();

  if (est.paid_until && new Date(est.paid_until).getTime() > now) {
    return (
      <span>
        Оплачено до{' '}
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--t1)' }}>
          {formatDate(est.paid_until)}
        </span>
      </span>
    );
  }

  if (est.trial_ends_at && new Date(est.trial_ends_at).getTime() > now) {
    return (
      <span>
        Trial до{' '}
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--warn)' }}>
          {formatDate(est.trial_ends_at)}
        </span>
      </span>
    );
  }

  return <span style={{ color: 'var(--bad)' }}>Підписка закінчилась</span>;
}

interface TelegramStatus {
  connected: boolean;
  prefs: Record<string, boolean>;
}

export default async function SettingsPage() {
  const [establishment, telegramStatus] = await Promise.all([
    apiFetch<Establishment>('/api/v1/establishments/me'),
    apiFetch<TelegramStatus>('/api/v1/telegram/status').catch(() => ({ connected: false, prefs: {} })),
  ]);

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--t1)' }}>Налаштування</h1>
      </div>

      {/* Establishment info */}
      <div
        className="rounded-lg mb-4"
        style={{
          background: 'var(--s2)',
          border: '1px solid var(--br)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
        }}
      >
        <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--br)' }}>
          <p className="text-sm font-semibold" style={{ color: 'var(--t1)' }}>Заклад</p>
        </div>
        <div className="px-5 divide-y" style={{ borderColor: 'var(--br)' }}>
          <InfoRow label="Назва">
            <span style={{ color: 'var(--t1)', fontWeight: 500 }}>{establishment.name}</span>
          </InfoRow>
          <InfoRow label="Тариф">
            <span className={`text-xs font-medium px-2 py-0.5 rounded ${PLAN_COLORS[establishment.plan] ?? PLAN_COLORS.starter}`}>
              {PLAN_LABELS[establishment.plan] ?? establishment.plan}
            </span>
          </InfoRow>
          <InfoRow label="Статус">
            {billingStatus(establishment)}
          </InfoRow>
        </div>
      </div>

      {/* Retention settings — client form */}
      <SettingsForm
        initialSettings={establishment.settings as Record<string, unknown> | null}
        initialTimezone={establishment.timezone ?? 'Europe/Kyiv'}
        initialSlaMinutes={establishment.delivery_sla_minutes ?? null}
        initialLat={establishment.lat ?? null}
        initialLng={establishment.lng ?? null}
        initialDispatchMode={establishment.dispatch_mode ?? 'manual'}
      />

      {/* Telegram notifications */}
      <TelegramSettings initialStatus={telegramStatus} />
    </div>
  );
}
