'use client';

import { useState, useTransition } from 'react';
import { apiPatch } from '@/lib/api-client';

interface SettingsPayload {
  retention_orders_days?: number;
  retention_pings_days?: number;
  courier_not_responding_min?: number;
  timezone?: string;
}

interface Props {
  initialSettings: SettingsPayload | null;
  initialTimezone: string;
}

function SectionCard({ title, description, children }: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-lg mb-4"
      style={{
        background: 'var(--s2)',
        border: '1px solid var(--br)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
      }}
    >
      <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--br)' }}>
        <p className="text-sm font-semibold" style={{ color: 'var(--t1)' }}>{title}</p>
        {description && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--t4)' }}>{description}</p>
        )}
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function FieldRow({ label, hint, children }: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 gap-6">
      <div className="min-w-0">
        <p className="text-sm" style={{ color: 'var(--t2)' }}>{label}</p>
        {hint && <p className="text-xs mt-0.5" style={{ color: 'var(--t4)' }}>{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  suffix: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const v = Math.min(max, Math.max(min, parseInt(e.target.value) || min));
          onChange(v);
        }}
        className="w-16 text-center text-sm rounded outline-none transition-all"
        style={{
          fontFamily: 'var(--font-mono)',
          background: 'var(--s1)',
          border: '1px solid var(--br)',
          color: 'var(--t1)',
          padding: '5px 8px',
        }}
        onFocus={(e) =>
          (e.currentTarget.style.boxShadow = '0 0 0 1px var(--bg), 0 0 0 3px var(--acm)')
        }
        onBlur={(e) => (e.currentTarget.style.boxShadow = 'none')}
      />
      <span className="text-sm" style={{ color: 'var(--t4)' }}>{suffix}</span>
    </div>
  );
}

const NOT_RESPONDING_OPTIONS = [10, 15, 30, 60] as const;

// Must stay in sync with ALLOWED_TIMEZONES in apps/api/src/establishments/dto/update-settings.dto.ts
const TIMEZONE_OPTIONS = [
  { value: 'Europe/Kyiv',   label: 'Київ (UTC+2/+3)' },
  { value: 'Europe/Warsaw', label: 'Варшава (UTC+1/+2)' },
  { value: 'Europe/Prague', label: 'Прага (UTC+1/+2)' },
  { value: 'Europe/Berlin', label: 'Берлін (UTC+1/+2)' },
  { value: 'Europe/Riga',   label: 'Рига (UTC+2/+3)' },
] as const;

export function SettingsForm({ initialSettings, initialTimezone }: Props) {
  const [retentionOrders, setRetentionOrders] = useState(
    initialSettings?.retention_orders_days ?? 14,
  );
  const [retentionPings, setRetentionPings] = useState(
    initialSettings?.retention_pings_days ?? 3,
  );
  const [courierNotRespondingMin, setCourierNotRespondingMin] = useState(
    initialSettings?.courier_not_responding_min ?? 15,
  );
  const [timezone, setTimezone] = useState(initialTimezone);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    setError('');
    setSaved(false);
    startTransition(async () => {
      try {
        await apiPatch('/api/v1/establishments/me/settings', {
          retention_orders_days: retentionOrders,
          retention_pings_days: retentionPings,
          courier_not_responding_min: courierNotRespondingMin,
          timezone,
        });
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Помилка збереження');
      }
    });
  }

  return (
    <>
    <SectionCard title="Часовий пояс" description="Використовується для відображення часу в Telegram-сповіщеннях">
      <select
        value={timezone}
        onChange={(e) => setTimezone(e.target.value)}
        className="w-full text-sm rounded outline-none transition-all"
        style={{
          fontFamily: 'var(--font-sans)',
          background: 'var(--s1)',
          border: '1px solid var(--br)',
          color: 'var(--t1)',
          padding: '7px 10px',
          borderRadius: '6px',
          cursor: 'pointer',
        }}
        onFocus={(e) =>
          (e.currentTarget.style.boxShadow = '0 0 0 1px var(--bg), 0 0 0 3px var(--acm)')
        }
        onBlur={(e) => (e.currentTarget.style.boxShadow = 'none')}
      >
        {TIMEZONE_OPTIONS.map((tz) => (
          <option key={tz.value} value={tz.value}>
            {tz.label}
          </option>
        ))}
      </select>
    </SectionCard>

    <SectionCard
      title="Зберігання даних"
      description="Старі записи автоматично видаляються. Докази доставки зберігаються назавжди."
    >
      <div className="divide-y" style={{ borderColor: 'var(--br)' }}>
        <FieldRow
          label="Замовлення"
          hint="Завершені, скасовані та провалені замовлення"
        >
          <NumberInput
            value={retentionOrders}
            onChange={setRetentionOrders}
            min={1}
            max={30}
            suffix="днів"
          />
        </FieldRow>

        <FieldRow
          label="GPS-пінги"
          hint="Точки маршруту курʼєрів"
        >
          <NumberInput
            value={retentionPings}
            onChange={setRetentionPings}
            min={1}
            max={3}
            suffix="днів"
          />
        </FieldRow>
      </div>

      <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--br)' }}>
        <p
          className="mb-3"
          style={{ color: 'var(--t4)', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}
        >
          Сповіщення
        </p>
        <FieldRow
          label="Курʼєр не відповідає"
          hint="Поріг мовчання під час активної доставки"
        >
          <div className="flex items-center gap-1">
            {NOT_RESPONDING_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setCourierNotRespondingMin(opt)}
                className="text-xs font-medium transition-colors"
                style={{
                  padding: '5px 10px',
                  borderRadius: '6px',
                  fontFamily: 'var(--font-mono)',
                  background: courierNotRespondingMin === opt ? 'var(--acm)' : 'transparent',
                  color: courierNotRespondingMin === opt ? 'var(--bg)' : 'var(--t4)',
                  border: `1px solid ${courierNotRespondingMin === opt ? 'var(--acm)' : 'var(--br)'}`,
                }}
              >
                {opt} хв
              </button>
            ))}
          </div>
        </FieldRow>
      </div>

      <div className="flex items-center justify-between mt-4 pt-4 border-t" style={{ borderColor: 'var(--br)' }}>
        <div className="text-sm h-5">
          {error && <span style={{ color: 'var(--bad)' }}>{error}</span>}
          {saved && <span style={{ color: 'var(--ok)' }}>Збережено</span>}
        </div>
        <button
          onClick={handleSave}
          disabled={isPending}
          className="text-sm font-medium rounded transition-opacity disabled:opacity-50"
          style={{
            background: 'var(--acm)',
            color: 'var(--bg)',
            padding: '6px 16px',
            borderRadius: '6px',
          }}
        >
          {isPending ? 'Зберігаємо…' : 'Зберегти'}
        </button>
      </div>
    </SectionCard>
    </>
  );
}
