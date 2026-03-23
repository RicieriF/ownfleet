'use client';

import { useState, useTransition } from 'react';
import { apiPatch } from '@/lib/api-client';

interface SettingsPayload {
  retention_orders_days?: number;
  retention_pings_days?: number;
}

interface Props {
  initialSettings: SettingsPayload | null;
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
          (e.currentTarget.style.boxShadow = '0 0 0 1px var(--bg), 0 0 0 3px #6aaa84')
        }
        onBlur={(e) => (e.currentTarget.style.boxShadow = 'none')}
      />
      <span className="text-sm" style={{ color: 'var(--t4)' }}>{suffix}</span>
    </div>
  );
}

export function SettingsForm({ initialSettings }: Props) {
  const [retentionOrders, setRetentionOrders] = useState(
    initialSettings?.retention_orders_days ?? 14,
  );
  const [retentionPings, setRetentionPings] = useState(
    initialSettings?.retention_pings_days ?? 3,
  );
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
        });
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Помилка збереження');
      }
    });
  }

  return (
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
            background: '#6aaa84',
            color: '#09090b',
            padding: '6px 16px',
            borderRadius: '6px',
          }}
        >
          {isPending ? 'Зберігаємо…' : 'Зберегти'}
        </button>
      </div>
    </SectionCard>
  );
}
