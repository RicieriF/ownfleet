'use client';

import { useState, useEffect, useCallback } from 'react';
import { CourierWithStatus, CourierStatus } from '@/types';
import { getSocket } from '@/lib/socket';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { uk } from 'date-fns/locale';
import { apiPost, apiPatch } from '@/lib/api-client';

interface ActiveShift {
  id: string;
  courier_id: string;
  establishment_id: string;
  started_at: string;
  ended_at: string | null;
  ended_by: 'courier' | 'manager' | 'auto' | null;
  planned_end_at: string | null;
  total_deliveries: number;
  total_distance_km: number | null;
  courier: { id: string; name: string; phone: string };
}

interface ShiftStartedEvent {
  shift_id: string;
  courier_id: string;
  started_at: string;
  planned_end_at: string | null;
}

interface ShiftEndedEvent {
  shift_id: string;
  courier_id: string;
  ended_by: 'courier' | 'manager' | 'auto';
  ended_at: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return h > 0 ? `${h}г ${String(m).padStart(2, '0')}хв` : `${m}хв`;
}

function ShiftDuration({ startedAt }: { startedAt: string }) {
  const [label, setLabel] = useState('');

  useEffect(() => {
    function tick() {
      setLabel(formatDuration(Date.now() - new Date(startedAt).getTime()));
    }
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [startedAt]);

  return <span className="mono">{label}</span>;
}

const STATUS_DOT: Record<CourierStatus, string> = {
  online:         'bg-[var(--ok)]',
  background:     'bg-[var(--warn)]',
  not_responding: 'bg-[var(--bad)]',
  offline:        'bg-[var(--t4)]',
};

const DURATION_PRESETS = [
  { label: '+4г', hours: 4 },
  { label: '+8г', hours: 8 },
  { label: '+10г', hours: 10 },
  { label: '+12г', hours: 12 },
];

// ── Planned end inline editor ────────────────────────────────────────────────

function PlannedEndCell({
  shiftId,
  plannedEndAt,
  timezone,
  onUpdated,
}: {
  shiftId: string;
  plannedEndAt: string | null;
  timezone: string;
  onUpdated: (val: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function setPreset(hours: number) {
    setSaving(true);
    const planned_end_at = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    try {
      await apiPatch(`/api/v1/shifts/${shiftId}/planned-end`, { planned_end_at });
      onUpdated(planned_end_at);
    } finally {
      setSaving(false);
      setOpen(false);
    }
  }

  async function clearEnd() {
    setSaving(true);
    try {
      await apiPatch(`/api/v1/shifts/${shiftId}/planned-end`, { planned_end_at: null });
      onUpdated(null);
    } finally {
      setSaving(false);
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      {plannedEndAt ? (
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-[var(--t2)] mono text-sm hover:text-[var(--t1)] transition-colors underline underline-offset-2 decoration-[var(--br2)]"
        >
          {new Date(plannedEndAt).toLocaleTimeString('uk-UA', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: timezone,
          })}
        </button>
      ) : (
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-[var(--t4)] text-sm hover:text-[var(--t3)] transition-colors"
        >
          — встановити
        </button>
      )}

      {open && (
        <div className="absolute z-10 top-full left-0 mt-1 bg-[var(--sf)] border border-[var(--br)] rounded-[6px] p-2 shadow-lg flex gap-1.5 flex-wrap w-48">
          {DURATION_PRESETS.map((p) => (
            <button
              key={p.hours}
              onClick={() => setPreset(p.hours)}
              disabled={saving}
              className="px-2 py-1 text-[11px] rounded border border-[var(--br)] text-[var(--t3)] hover:border-[var(--br2)] hover:text-[var(--t2)] transition-colors disabled:opacity-40"
            >
              {p.label}
            </button>
          ))}
          {plannedEndAt && (
            <button
              onClick={clearEnd}
              disabled={saving}
              className="px-2 py-1 text-[11px] rounded border border-[var(--br)] text-[var(--t3)] hover:border-[var(--bad)] hover:text-[var(--bad)] transition-colors disabled:opacity-40"
            >
              Зняти
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

interface Props {
  initialShifts: ActiveShift[];
  couriers: CourierWithStatus[];
  notOnShift: CourierWithStatus[];
  timezone: string;
}

export function ShiftsManager({ initialShifts, couriers, notOnShift: initialNotOnShift, timezone }: Props) {
  const [shifts, setShifts] = useState(initialShifts);
  const [notOnShift, setNotOnShift] = useState(initialNotOnShift);
  const [endingShift, setEndingShift] = useState<string | null>(null);
  const [remindLoading, setRemindLoading] = useState<string | null>(null);

  // Build courier status map for status dots
  const statusMap = new Map<string, CourierStatus>(
    couriers.map((c) => [c.id, c.status])
  );

  useEffect(() => {
    const socket = getSocket();

    socket.on('shift:started', (event: ShiftStartedEvent) => {
      // We don't have full courier info from the event alone, so just remove from notOnShift
      setNotOnShift((prev) => prev.filter((c) => c.id !== event.courier_id));
    });

    socket.on('shift:ended', (event: ShiftEndedEvent) => {
      setShifts((prev) => prev.filter((s) => s.id !== event.shift_id));
      // Re-add to notOnShift if they're in couriers list
      const courier = couriers.find((c) => c.id === event.courier_id);
      if (courier) {
        setNotOnShift((prev) =>
          prev.some((c) => c.id === courier.id) ? prev : [...prev, courier]
        );
      }
    });

    return () => {
      socket.off('shift:started');
      socket.off('shift:ended');
    };
  }, [couriers]);

  const handleEndShift = useCallback(async (shiftId: string) => {
    setEndingShift(shiftId);
    try {
      await apiPost(`/api/v1/shifts/${shiftId}/end`);
      setShifts((prev) => prev.filter((s) => s.id !== shiftId));
    } catch {
      // error is non-critical for UI — shift:ended WS event will update state anyway
    } finally {
      setEndingShift(null);
    }
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

  function handlePlannedEndUpdated(shiftId: string, val: string | null) {
    setShifts((prev) =>
      prev.map((s) => (s.id === shiftId ? { ...s, planned_end_at: val } : s))
    );
  }

  return (
    <div className="space-y-6">
      {/* Active shifts table */}
      <div className="bg-[var(--sf)] rounded-lg border border-[var(--br)] overflow-hidden card-shine">
        <div className="px-5 py-3.5 border-b border-[var(--br)] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--t1)]">Активні зміни</h2>
          <span className="mono text-xs text-[var(--t4)]">{shifts.length}</span>
        </div>

        {shifts.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-[var(--t3)]">
            Немає активних змін
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--br)]">
              <tr>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--t4)]">
                  Курʼєр
                </th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--t4)]">
                  Початок
                </th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--t4)]">
                  Тривалість
                </th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--t4)]">
                  Кінець зміни
                </th>
                <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--t4)]">
                  Доставок
                </th>
                <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--t4)]">
                  Км
                </th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--br)]">
              {shifts.map((shift) => {
                const courierStatus = statusMap.get(shift.courier_id) ?? 'offline';
                const isEnding = endingShift === shift.id;

                return (
                  <tr key={shift.id} className="hover:bg-[var(--s2)] transition-colors">
                    {/* Courier */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className="relative flex-shrink-0">
                          <div className={cn('w-2 h-2 rounded-full', STATUS_DOT[courierStatus])} />
                          {courierStatus === 'not_responding' && (
                            <div className="absolute inset-0 w-2 h-2 rounded-full bg-[var(--bad)] animate-ping opacity-50" />
                          )}
                        </div>
                        <div>
                          <span className="font-medium text-[var(--t1)]">{shift.courier.name}</span>
                          <span className="ml-2 mono text-xs text-[var(--t4)]">{shift.courier.phone}</span>
                        </div>
                      </div>
                    </td>

                    {/* Started at */}
                    <td className="px-3 py-2.5 mono text-sm text-[var(--t3)]">
                      {new Date(shift.started_at).toLocaleTimeString('uk-UA', {
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: timezone,
                      })}
                    </td>

                    {/* Duration */}
                    <td className="px-3 py-2.5 text-[var(--t2)]">
                      <ShiftDuration startedAt={shift.started_at} />
                    </td>

                    {/* Planned end — editable */}
                    <td className="px-3 py-2.5">
                      <PlannedEndCell
                        shiftId={shift.id}
                        plannedEndAt={shift.planned_end_at}
                        timezone={timezone}
                        onUpdated={(val) => handlePlannedEndUpdated(shift.id, val)}
                      />
                    </td>

                    {/* Deliveries */}
                    <td className="px-3 py-2.5 text-right mono text-[var(--t2)]">
                      {shift.total_deliveries}
                    </td>

                    {/* Distance */}
                    <td className="px-3 py-2.5 text-right mono text-[var(--t3)]">
                      {shift.total_distance_km != null
                        ? shift.total_distance_km.toFixed(1)
                        : '—'}
                    </td>

                    {/* End shift action */}
                    <td className="px-3 py-2.5 text-right">
                      <button
                        onClick={() => handleEndShift(shift.id)}
                        disabled={isEnding}
                        className="px-2.5 py-1 text-xs rounded border border-[var(--br)] text-[var(--t3)] hover:border-[var(--bad)] hover:text-[var(--bad)] transition-colors disabled:opacity-40"
                      >
                        {isEnding ? '…' : 'Завершити'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Couriers not on shift */}
      {notOnShift.length > 0 && (
        <div className="bg-[var(--sf)] rounded-lg border border-[var(--br)] overflow-hidden card-shine">
          <div className="px-5 py-3.5 border-b border-[var(--br)] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--t1)]">Не вийшли на зміну</h2>
            <span className="mono text-xs text-[var(--t4)]">{notOnShift.length}</span>
          </div>
          <div className="divide-y divide-[var(--br)]">
            {notOnShift.map((courier) => (
              <div key={courier.id} className="px-5 py-3 flex items-center gap-4 hover:bg-[var(--s2)] transition-colors">
                <div className="w-2 h-2 rounded-full bg-[var(--t4)] flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-[var(--t1)]">{courier.name}</span>
                  <span className="ml-2 mono text-xs text-[var(--t4)]">{courier.phone}</span>
                  {courier.last_ping_at && (
                    <span className="ml-2 text-xs text-[var(--t4)]">
                      · {formatDistanceToNow(new Date(courier.last_ping_at), { addSuffix: true, locale: uk })}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => handleRemind(courier.id)}
                  disabled={remindLoading === courier.id}
                  className="px-3 py-1.5 text-xs rounded-[6px] border border-[var(--br)] text-[var(--t3)] hover:border-[var(--br2)] hover:text-[var(--t2)] transition-colors disabled:opacity-40"
                >
                  {remindLoading === courier.id ? 'Надсилання…' : 'Нагадати'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
