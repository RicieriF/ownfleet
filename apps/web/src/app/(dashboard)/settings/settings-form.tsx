'use client';

import { useState, useTransition } from 'react';
import { apiPatch } from '@/lib/api-client';

interface SettingsPayload {
  retention_orders_days?: number;
  retention_pings_days?: number;
  courier_not_responding_min?: number;
  show_sla_on_dashboard?: boolean;
  eta_alert_enabled?: boolean;
  eta_alert_delay_minutes?: number;
  timezone?: string;
  delivery_sla_minutes?: number | null;
  lat?: number;
  lng?: number;
  auto_dispatch?: boolean;
}

interface Props {
  initialSettings: SettingsPayload | null;
  initialTimezone: string;
  initialSlaMinutes: number | null;
  initialLat: number | null;
  initialLng: number | null;
  initialAutoDispatch: boolean;
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
  value, onChange, min, max, suffix,
}: {
  value: number; onChange: (v: number) => void;
  min: number; max: number; suffix: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number" min={min} max={max} value={value}
        onChange={(e) => {
          const v = Math.min(max, Math.max(min, parseInt(e.target.value) || min));
          onChange(v);
        }}
        className="w-16 text-center text-sm rounded outline-none transition-all"
        style={{
          fontFamily: 'var(--font-mono)',
          background: 'var(--s1)', border: '1px solid var(--br)',
          color: 'var(--t1)', padding: '5px 8px',
        }}
        onFocus={(e) => (e.currentTarget.style.boxShadow = '0 0 0 1px var(--bg), 0 0 0 3px var(--acm)')}
        onBlur={(e) => (e.currentTarget.style.boxShadow = 'none')}
      />
      <span className="text-sm" style={{ color: 'var(--t4)' }}>{suffix}</span>
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors"
      style={{ background: value ? 'var(--acm)' : 'var(--s3)' }}
    >
      <span
        className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform"
        style={{ transform: value ? 'translateX(18px)' : 'translateX(2px)' }}
      />
    </button>
  );
}

function CoordInput({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <input
      type="text" value={value} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-28 text-sm rounded outline-none transition-all"
      style={{
        fontFamily: 'var(--font-mono)',
        background: 'var(--s1)', border: '1px solid var(--br)',
        color: 'var(--t1)', padding: '5px 8px',
      }}
      onFocus={(e) => (e.currentTarget.style.boxShadow = '0 0 0 1px var(--bg), 0 0 0 3px var(--acm)')}
      onBlur={(e) => (e.currentTarget.style.boxShadow = 'none')}
    />
  );
}

const NOT_RESPONDING_OPTIONS = [10, 15, 30, 60] as const;
const ETA_ALERT_DELAY_OPTIONS = [5, 10, 15, 30] as const;

// Must stay in sync with ALLOWED_TIMEZONES in apps/api/src/establishments/dto/update-settings.dto.ts
const TIMEZONE_OPTIONS = [
  { value: 'Europe/Kyiv',   label: 'Київ (UTC+2/+3)' },
  { value: 'Europe/Warsaw', label: 'Варшава (UTC+1/+2)' },
  { value: 'Europe/Prague', label: 'Прага (UTC+1/+2)' },
  { value: 'Europe/Berlin', label: 'Берлін (UTC+1/+2)' },
  { value: 'Europe/Riga',   label: 'Рига (UTC+2/+3)' },
] as const;

export function SettingsForm({
  initialSettings,
  initialTimezone,
  initialSlaMinutes,
  initialLat,
  initialLng,
  initialAutoDispatch,
}: Props) {
  const [retentionOrders, setRetentionOrders] = useState(initialSettings?.retention_orders_days ?? 14);
  const [retentionPings, setRetentionPings] = useState(initialSettings?.retention_pings_days ?? 3);
  const [courierNotRespondingMin, setCourierNotRespondingMin] = useState(initialSettings?.courier_not_responding_min ?? 15);
  const [timezone, setTimezone] = useState(initialTimezone);

  const [slaEnabled, setSlaEnabled] = useState(initialSlaMinutes !== null && initialSlaMinutes !== undefined);
  const [slaMinutes, setSlaMinutes] = useState(initialSlaMinutes ?? 45);
  const [showSlaOnDashboard, setShowSlaOnDashboard] = useState(initialSettings?.show_sla_on_dashboard ?? false);

  const [etaAlertEnabled, setEtaAlertEnabled] = useState(initialSettings?.eta_alert_enabled ?? false);
  const [etaAlertDelay, setEtaAlertDelay] = useState(initialSettings?.eta_alert_delay_minutes ?? 10);

  const [autoDispatch, setAutoDispatch] = useState(initialAutoDispatch);

  const [latStr, setLatStr] = useState(initialLat !== null && initialLat !== undefined ? String(initialLat) : '');
  const [lngStr, setLngStr] = useState(initialLng !== null && initialLng !== undefined ? String(initialLng) : '');

  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    setError('');
    setSaved(false);
    startTransition(async () => {
      try {
        const lat = latStr ? parseFloat(latStr) : undefined;
        const lng = lngStr ? parseFloat(lngStr) : undefined;

        await apiPatch('/api/v1/establishments/me/settings', {
          retention_orders_days: retentionOrders,
          retention_pings_days: retentionPings,
          courier_not_responding_min: courierNotRespondingMin,
          timezone,
          delivery_sla_minutes: slaEnabled ? slaMinutes : null,
          show_sla_on_dashboard: showSlaOnDashboard,
          eta_alert_enabled: etaAlertEnabled,
          eta_alert_delay_minutes: etaAlertDelay,
          auto_dispatch: autoDispatch,
          ...(lat !== undefined && !isNaN(lat) && { lat }),
          ...(lng !== undefined && !isNaN(lng) && { lng }),
        });
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Помилка збереження');
      }
    });
  }

  const selectStyle = {
    fontFamily: 'var(--font-sans)',
    background: 'var(--s1)', border: '1px solid var(--br)',
    color: 'var(--t1)', padding: '7px 10px', borderRadius: '6px', cursor: 'pointer',
  };

  return (
    <>
      {/* Timezone */}
      <SectionCard title="Часовий пояс" description="Використовується для відображення часу в Telegram-сповіщеннях">
        <select
          value={timezone} onChange={(e) => setTimezone(e.target.value)}
          className="w-full text-sm rounded outline-none transition-all"
          style={selectStyle}
          onFocus={(e) => (e.currentTarget.style.boxShadow = '0 0 0 1px var(--bg), 0 0 0 3px var(--acm)')}
          onBlur={(e) => (e.currentTarget.style.boxShadow = 'none')}
        >
          {TIMEZONE_OPTIONS.map((tz) => (
            <option key={tz.value} value={tz.value}>{tz.label}</option>
          ))}
        </select>
      </SectionCard>

      {/* ETA & SLA */}
      <SectionCard
        title="ETA та SLA доставок"
        description="Автоматичний розрахунок часу доставки та налаштування стандарту"
      >
        <div className="divide-y" style={{ borderColor: 'var(--br)' }}>
          <FieldRow
            label="Координати закладу"
            hint="Потрібні для розрахунку маршруту по вулицях"
          >
            <div className="flex items-center gap-2">
              <CoordInput value={latStr} onChange={setLatStr} placeholder="50.4501" />
              <CoordInput value={lngStr} onChange={setLngStr} placeholder="30.5234" />
            </div>
          </FieldRow>

          <FieldRow
            label="SLA доставки"
            hint="Ваш публічний стандарт для клієнтів"
          >
            <div className="flex items-center gap-3">
              <Toggle value={slaEnabled} onChange={setSlaEnabled} />
              {slaEnabled && (
                <NumberInput value={slaMinutes} onChange={setSlaMinutes} min={5} max={180} suffix="хв" />
              )}
            </div>
          </FieldRow>

          {slaEnabled && (
            <FieldRow
              label="Показувати SLA на дашборді"
              hint="Відображати поруч з ETA таймером"
            >
              <Toggle value={showSlaOnDashboard} onChange={setShowSlaOnDashboard} />
            </FieldRow>
          )}
        </div>

        <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--br)' }}>
          <p
            className="mb-3"
            style={{ color: 'var(--t4)', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}
          >
            Сповіщення про запізнення
          </p>
          <div className="divide-y" style={{ borderColor: 'var(--br)' }}>
            <FieldRow
              label="Сповіщати про запізнення ETA"
              hint="Telegram-повідомлення менеджеру"
            >
              <Toggle value={etaAlertEnabled} onChange={setEtaAlertEnabled} />
            </FieldRow>

            {etaAlertEnabled && (
              <FieldRow
                label="Через скільки хвилин після виходу ETA"
                hint="Щоб не спрацьовувати на незначні запізнення"
              >
                <div className="flex items-center gap-1">
                  {ETA_ALERT_DELAY_OPTIONS.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setEtaAlertDelay(opt)}
                      className="text-xs font-medium transition-colors"
                      style={{
                        padding: '5px 10px', borderRadius: '6px',
                        fontFamily: 'var(--font-mono)',
                        background: etaAlertDelay === opt ? 'var(--acm)' : 'transparent',
                        color: etaAlertDelay === opt ? 'var(--bg)' : 'var(--t4)',
                        border: `1px solid ${etaAlertDelay === opt ? 'var(--acm)' : 'var(--br)'}`,
                      }}
                    >
                      {opt} хв
                    </button>
                  ))}
                </div>
              </FieldRow>
            )}
          </div>
        </div>
      </SectionCard>

      {/* Dispatch mode */}
      <SectionCard
        title="Режим призначення"
        description="Керуйте тим, як замовлення потрапляють до курʼєрів"
      >
        <FieldRow
          label="Самостійне призначення курʼєрами"
          hint="Курʼєри бачать пул непризначених замовлень і можуть самостійно взяти доставку"
        >
          <Toggle value={autoDispatch} onChange={setAutoDispatch} />
        </FieldRow>
      </SectionCard>

      {/* Retention */}
      <SectionCard
        title="Зберігання даних"
        description="Старі записи автоматично видаляються. Докази доставки зберігаються назавжди."
      >
        <div className="divide-y" style={{ borderColor: 'var(--br)' }}>
          <FieldRow label="Замовлення" hint="Завершені, скасовані та провалені замовлення">
            <NumberInput value={retentionOrders} onChange={setRetentionOrders} min={1} max={30} suffix="днів" />
          </FieldRow>
          <FieldRow label="GPS-пінги" hint="Точки маршруту курʼєрів">
            <NumberInput value={retentionPings} onChange={setRetentionPings} min={1} max={3} suffix="днів" />
          </FieldRow>
        </div>

        <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--br)' }}>
          <p
            className="mb-3"
            style={{ color: 'var(--t4)', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}
          >
            Сповіщення
          </p>
          <FieldRow label="Курʼєр не відповідає" hint="Поріг мовчання під час активної доставки">
            <div className="flex items-center gap-1">
              {NOT_RESPONDING_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setCourierNotRespondingMin(opt)}
                  className="text-xs font-medium transition-colors"
                  style={{
                    padding: '5px 10px', borderRadius: '6px',
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
            style={{ background: 'var(--acm)', color: 'var(--bg)', padding: '6px 16px', borderRadius: '6px' }}
          >
            {isPending ? 'Зберігаємо…' : 'Зберегти'}
          </button>
        </div>
      </SectionCard>
    </>
  );
}
