'use client';

import { useState, useTransition } from 'react';
import { apiPost, apiPatch, clientFetch } from '@/lib/api-client';
import { useT } from '@/lib/i18n/client';

interface ManagerPrefs {
  order_created?: boolean;
  delivery_assigned?: boolean;
  delivery_completed?: boolean;
  delivery_failed?: boolean;
  delivery_force_closed?: boolean;
  courier_shift_started?: boolean;
  courier_shift_ended?: boolean;
  courier_shift_auto_closed?: boolean;
  courier_not_responding?: boolean;
}

interface TelegramStatus {
  connected: boolean;
  prefs: ManagerPrefs;
}

interface Props {
  initialStatus: TelegramStatus;
}

const PREF_LABELS: { key: keyof ManagerPrefs; label: string; group: string }[] = [
  { key: 'order_created',           label: 'Нове замовлення надійшло',          group: 'ЗАМОВЛЕННЯ' },
  { key: 'delivery_assigned',       label: 'Доставка призначена курʼєру',        group: 'ЗАМОВЛЕННЯ' },
  { key: 'delivery_completed',      label: 'Доставка завершена',                group: 'ЗАМОВЛЕННЯ' },
  { key: 'delivery_failed',         label: 'Доставка провалена',                group: 'ЗАМОВЛЕННЯ' },
  { key: 'delivery_force_closed',   label: 'Доставку закрито вручну',           group: 'ЗАМОВЛЕННЯ' },
  { key: 'courier_shift_started',   label: 'Курʼєр вийшов на зміну',            group: 'КУРЄРИ' },
  { key: 'courier_shift_ended',     label: 'Курʼєр завершив зміну',             group: 'КУРЄРИ' },
  { key: 'courier_shift_auto_closed', label: 'Зміну закрито автоматично',       group: 'КУРЄРИ' },
  { key: 'courier_not_responding',   label: 'Курʼєр не відповідає під час доставки', group: 'КУРЄРИ' },
];

export function TelegramSettings({ initialStatus }: Props) {
  const t = useT();
  const [connected, setConnected] = useState(initialStatus.connected);
  const [prefs, setPrefs] = useState<ManagerPrefs>(initialStatus.prefs);
  const [connectCode, setConnectCode] = useState<string | null>(null);
  const [prefsSaved, setPrefsSaved] = useState(false);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  function handleTogglePref(key: keyof ManagerPrefs) {
    setPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
    setPrefsSaved(false);
  }

  function handleConnect() {
    setError('');
    startTransition(async () => {
      try {
        const res = await apiPost<{ code: string; expires_in: number }>('/api/v1/telegram/connect');
        setConnectCode(res.code);
      } catch {
        setError(t('Не вдалось згенерувати код. Спробуйте ще раз.'));
      }
    });
  }

  function handleDisconnect() {
    setError('');
    startTransition(async () => {
      try {
        await clientFetch('/api/v1/telegram/connect', { method: 'DELETE' });
        setConnected(false);
        setConnectCode(null);
        setPrefs({});
      } catch {
        setError(t('Не вдалось відключити. Спробуйте ще раз.'));
      }
    });
  }

  function handleSavePrefs() {
    setError('');
    setPrefsSaved(false);
    startTransition(async () => {
      try {
        await apiPatch('/api/v1/telegram/prefs', prefs);
        setPrefsSaved(true);
        setTimeout(() => setPrefsSaved(false), 3000);
      } catch {
        setError(t('Не вдалось зберегти налаштування.'));
      }
    });
  }

  // Group prefs by section
  const groups = ['ЗАМОВЛЕННЯ', 'КУРЄРИ'] as const;

  return (
    <div
      className="rounded-lg mb-4"
      style={{
        background: 'var(--s2)',
        border: '1px solid var(--br)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
      }}
    >
      {/* Header */}
      <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--br)' }}>
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--t1)' }}>{t('Telegram сповіщення')}</p>
          {connected && (
            <p className="text-xs mt-0.5 flex items-center gap-1.5">
              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--ok)', flexShrink: 0 }} />
              <span style={{ color: 'var(--t3)' }}>{t('Підключено')}</span>
            </p>
          )}
        </div>
        {connected ? (
          <button
            onClick={handleDisconnect}
            disabled={isPending}
            className="text-xs disabled:opacity-40"
            style={{ color: 'var(--bad)' }}
          >
            {t('Відключити')}
          </button>
        ) : (
          <button
            onClick={handleConnect}
            disabled={isPending}
            className="text-sm font-medium rounded disabled:opacity-40"
            style={{ background: 'var(--acm)', color: 'var(--t1)', padding: '5px 14px', borderRadius: '6px' }}
          >
            {isPending ? t('Генеруємо…') : t('Підключити')}
          </button>
        )}
      </div>

      {/* Connect code banner */}
      {!connected && connectCode && (
        <div
          className="mx-5 my-4 px-4 py-3 rounded-md"
          style={{ background: 'var(--s2)', border: '1px solid var(--br2)' }}
        >
          <p className="text-xs font-semibold mb-1" style={{ color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {t('Код для підключення · діє 10 хв')}
          </p>
          <p
            className="text-2xl font-bold tracking-widest my-2"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--t1)' }}
          >
            {connectCode}
          </p>
          <p className="text-xs" style={{ color: 'var(--t3)' }}>
            {t('Відкрийте бота')} <span style={{ color: 'var(--t2)' }}>@ownfleet_bot</span> {t('і надішліть:')}
          </p>
          <p
            className="text-sm mt-1"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--t2)' }}
          >
            /start {connectCode}
          </p>
          <p className="text-xs mt-2" style={{ color: 'var(--t3)' }}>
            {t('Після підключення оновіть сторінку.')}
          </p>
        </div>
      )}

      {/* Not connected placeholder */}
      {!connected && !connectCode && (
        <div className="px-5 py-5 text-sm" style={{ color: 'var(--t3)' }}>
          {t('Отримуйте сповіщення про замовлення та курʼєрів прямо в Telegram. Підключення займає 30 секунд.')}
        </div>
      )}

      {/* Prefs — shown only when connected */}
      {connected && (
        <div className="px-5 py-4">
          {groups.map((group) => (
            <div key={group} className="mb-4">
              <p className="mb-2" style={{ color: 'var(--t4)', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t(group)}
              </p>
              <div className="space-y-2">
                {PREF_LABELS.filter((p) => p.group === group).map(({ key, label }) => (
                  <label
                    key={key}
                    className="flex items-center gap-3 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={!!prefs[key]}
                      onChange={() => handleTogglePref(key)}
                      className="w-4 h-4 rounded accent-[var(--t1)]"
                    />
                    <span className="text-sm" style={{ color: 'var(--t2)' }}>{t(label)}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}

          {error && <p className="text-xs mb-3" style={{ color: 'var(--bad)' }}>{error}</p>}

          <div className="flex items-center gap-3 mt-2 pt-3 border-t" style={{ borderColor: 'var(--br)' }}>
            <button
              onClick={handleSavePrefs}
              disabled={isPending}
              className="text-sm font-medium rounded disabled:opacity-40"
              style={{ background: 'var(--acm)', color: 'var(--t1)', padding: '6px 16px', borderRadius: '6px' }}
            >
              {isPending ? t('Зберігаємо…') : t('Зберегти налаштування')}
            </button>
            {prefsSaved && (
              <span className="text-sm" style={{ color: 'var(--t3)' }}>{t('Збережено')}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
