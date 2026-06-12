'use client';

import { useState, useEffect, useCallback } from 'react';
import { CourierWithStatus, CourierStatus, CourierMovedEvent } from '@/types';
import { getSocket } from '@/lib/socket';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { uk } from 'date-fns/locale';
import { apiPost, apiPatch } from '@/lib/api-client';
import { useT } from '@/lib/i18n/client';

const STATUS_CONFIG: Record<CourierStatus, { dot: string; label: string; labelColor: string }> = {
  online:         { dot: 'bg-[var(--ok)]',   label: 'На зміні',      labelColor: 'text-[var(--t3)]' },
  background:     { dot: 'bg-[var(--warn)]',  label: 'Фон',           labelColor: 'text-[var(--t3)]' },
  not_responding: { dot: 'bg-[var(--bad)]',   label: 'Не відповідає', labelColor: 'text-[var(--t3)]' },
  offline:        { dot: 'bg-[var(--t4)]',    label: 'Офлайн',        labelColor: 'text-[var(--t4)]' },
};

// ── Shift timer helpers ─────────────────────────────────────────────────────

function formatDuration(ms: number, hUnit: string, mUnit: string): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return h > 0 ? `${h}${hUnit} ${String(m).padStart(2, '0')}${mUnit}` : `${m}${mUnit}`;
}

function ShiftTimer({ startedAt, plannedEndAt }: { startedAt: string; plannedEndAt: string | null }) {
  const t = useT();
  const [label, setLabel] = useState('');

  useEffect(() => {
    function tick() {
      const now = Date.now();
      if (plannedEndAt) {
        const remaining = new Date(plannedEndAt).getTime() - now;
        setLabel(remaining <= 0 ? t('завершується') : `${t('ще')} ${formatDuration(remaining, t('г'), t('хв'))}`);
      } else {
        setLabel(formatDuration(now - new Date(startedAt).getTime(), t('г'), t('хв')));
      }
    }
    tick();
    const id = setInterval(tick, 30_000); // update every 30s (dashboard doesn't need per-second)
    return () => clearInterval(id);
  }, [startedAt, plannedEndAt]);

  return (
    <span className="text-xs mono text-[var(--t3)]">{label}</span>
  );
}

// ── Planned end editor ──────────────────────────────────────────────────────

const DURATION_PRESETS = [
  { label: '+4г', hours: 4 },
  { label: '+8г', hours: 8 },
  { label: '+10г', hours: 10 },
  { label: '+12г', hours: 12 },
];

function PlannedEndEditor({
  shiftId,
  currentPlannedEnd,
  onUpdated,
}: {
  shiftId: string;
  currentPlannedEnd: string | null;
  onUpdated: (newValue: string | null) => void;
}) {
  const [saving, setSaving] = useState(false);

  async function setPreset(hours: number) {
    setSaving(true);
    const planned_end_at = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    try {
      await apiPatch(`/api/v1/shifts/${shiftId}/planned-end`, { planned_end_at });
      onUpdated(planned_end_at);
    } catch {
      // silent — non-critical
    } finally {
      setSaving(false);
    }
  }

  async function clearPlannedEnd() {
    setSaving(true);
    try {
      await apiPatch(`/api/v1/shifts/${shiftId}/planned-end`, { planned_end_at: null });
      onUpdated(null);
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
      {DURATION_PRESETS.map((p) => (
        <button
          key={p.hours}
          onClick={() => setPreset(p.hours)}
          disabled={saving}
          className="px-2 py-0.5 text-[11px] rounded border border-[var(--br)] text-[var(--t3)] hover:border-[var(--br2)] hover:text-[var(--t2)] transition-colors disabled:opacity-40"
        >
          {p.label}
        </button>
      ))}
      {currentPlannedEnd && (
        <button
          onClick={clearPlannedEnd}
          disabled={saving}
          className="px-2 py-0.5 text-[11px] rounded border border-[var(--br)] text-[var(--t3)] hover:border-[var(--bad)] hover:text-[var(--bad)] transition-colors disabled:opacity-40"
        >
          ×
        </button>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

interface Props {
  couriers: CourierWithStatus[];
  establishmentTimezone: string;
}

export function CouriersList({ couriers: initial, establishmentTimezone }: Props) {
  const t = useT();
  const [couriers, setCouriers] = useState(initial);
  const [remindLoading, setRemindLoading] = useState<string | null>(null);
  const [editingShift, setEditingShift] = useState<string | null>(null); // courier id

  useEffect(() => {
    const socket = getSocket();

    socket.on('courier:moved', (event: CourierMovedEvent) => {
      setCouriers((prev) =>
        prev.map((c) =>
          c.id === event.courier_id
            ? {
                ...c,
                last_ping_at: new Date(event.ts).toISOString(),
                last_lat: event.lat,
                last_lng: event.lng,
                status: computeStatus(new Date(event.ts).toISOString(), c),
              }
            : c,
        ),
      );
    });

    return () => { socket.off('courier:moved'); };
  }, []);

  const handleRemind = useCallback(async (courierId: string) => {
    setRemindLoading(courierId);
    try {
      await apiPost(`/api/v1/couriers/${courierId}/remind`);
    } catch {
      // fire-and-forget
    } finally {
      setRemindLoading(null);
    }
  }, []);

  function handlePlannedEndUpdated(courierId: string, newValue: string | null) {
    setCouriers((prev) =>
      prev.map((c) =>
        c.id === courierId && c.active_shift
          ? { ...c, active_shift: { ...c.active_shift, planned_end_at: newValue } }
          : c,
      ),
    );
    setEditingShift(null);
  }

  return (
    <div className="grid gap-2">
      {couriers.map((courier) => {
        const config = STATUS_CONFIG[courier.status];
        const isEditingThis = editingShift === courier.id;

        return (
          <div
            key={courier.id}
            className="bg-[var(--sf)] rounded-lg border border-[var(--br)] px-4 py-3 card-shine"
          >
            <div className="flex items-center gap-4">
              {/* Status dot */}
              <div className="relative flex-shrink-0">
                <div className={cn('w-2.5 h-2.5 rounded-full', config.dot)} />
                {courier.status === 'not_responding' && (
                  <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-[var(--bad)] animate-ping opacity-50" />
                )}
                {courier.status === 'background' && (
                  <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-[var(--warn)] animate-pulse opacity-40" />
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-[var(--t1)]">{courier.name}</span>
                  <span className="text-xs text-[var(--t3)] mono">{courier.phone}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={cn('text-xs font-medium', config.labelColor)}>
                    {t(config.label)}
                  </span>
                  {courier.last_ping_at && (
                    <span className="text-xs text-[var(--t4)] mono">
                      · {formatDistanceToNow(new Date(courier.last_ping_at), {
                          addSuffix: true,
                          locale: uk,
                        })}
                    </span>
                  )}
                  {!courier.active && (
                    <span className="text-xs text-[var(--t4)] italic">{t('неактивний')}</span>
                  )}
                </div>

                {/* Shift timer row */}
                {courier.active_shift && (
                  <div className="flex items-center gap-2 mt-1">
                    <ShiftTimer
                      startedAt={courier.active_shift.started_at}
                      plannedEndAt={courier.active_shift.planned_end_at}
                    />
                    {courier.active_shift.planned_end_at && (
                      <span className="text-[11px] text-[var(--t4)]">
                        · {t('до')} {new Date(courier.active_shift.planned_end_at).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: establishmentTimezone })}
                      </span>
                    )}
                    <button
                      onClick={() => setEditingShift(isEditingThis ? null : courier.id)}
                      className="text-[11px] text-[var(--t3)] hover:text-[var(--t2)] transition-colors underline underline-offset-2"
                    >
                      {isEditingThis ? t('Закрити') : t('Змінити час')}
                    </button>
                  </div>
                )}

                {/* Inline planned-end editor */}
                {isEditingThis && courier.active_shift && (
                  <PlannedEndEditor
                    shiftId={courier.active_shift.id}
                    currentPlannedEnd={courier.active_shift.planned_end_at}
                    onUpdated={(val) => handlePlannedEndUpdated(courier.id, val)}
                  />
                )}
              </div>

              {/* Remind button */}
              {courier.status === 'not_responding' && (
                <button
                  onClick={() => handleRemind(courier.id)}
                  disabled={remindLoading === courier.id}
                  className="px-3 py-1.5 text-xs bg-[rgba(239,68,68,0.1)] text-[var(--bad)] border border-[rgba(239,68,68,0.25)] rounded-[6px] hover:bg-[rgba(239,68,68,0.2)] transition-colors disabled:opacity-50"
                >
                  {remindLoading === courier.id ? t('Надсилання...') : t('Нагадати')}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function computeStatus(lastPingAt: string | null, courier: CourierWithStatus): CourierStatus {
  if (!lastPingAt) return 'offline';
  const diffSec = (Date.now() - new Date(lastPingAt).getTime()) / 1000;
  if (diffSec < 30) return 'online';
  if (diffSec < 300) return 'background';
  return courier.status === 'not_responding' ? 'not_responding' : 'offline';
}
