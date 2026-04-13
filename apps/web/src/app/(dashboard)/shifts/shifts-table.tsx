'use client';

import { useState, useEffect } from 'react';
import { ActiveShiftWithCourier } from '@/types';
import { apiPatch, apiPost } from '@/lib/api-client';
import { cn } from '@/lib/utils';

// ── Duration helpers ────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return h > 0 ? `${h}г ${String(m).padStart(2, '0')}хв` : `${m}хв`;
}

function LiveDuration({ startedAt }: { startedAt: string }) {
  const [label, setLabel] = useState('');

  useEffect(() => {
    function tick() {
      setLabel(formatDuration(Date.now() - new Date(startedAt).getTime()));
    }
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [startedAt]);

  return <span className="mono text-[var(--t2)]">{label}</span>;
}

// ── Planned end presets ─────────────────────────────────────────────────────

const DURATION_PRESETS = [
  { label: '+4г', hours: 4 },
  { label: '+8г', hours: 8 },
  { label: '+10г', hours: 10 },
  { label: '+12г', hours: 12 },
];

function PlannedEndEditor({
  shiftId,
  currentPlannedEnd,
  timezone,
  onUpdated,
  onClose,
}: {
  shiftId: string;
  currentPlannedEnd: string | null;
  timezone: string;
  onUpdated: (val: string | null) => void;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);

  async function setPreset(hours: number) {
    setSaving(true);
    const planned_end_at = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    try {
      await apiPatch(`/api/v1/shifts/${shiftId}/planned-end`, { planned_end_at });
      onUpdated(planned_end_at);
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
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
    <div className="flex items-center gap-1.5 flex-wrap">
      {DURATION_PRESETS.map((p) => (
        <button
          key={p.hours}
          onClick={() => setPreset(p.hours)}
          disabled={saving}
          className="px-2 py-0.5 text-[11px] rounded border border-[var(--br)] text-[var(--t4)] hover:border-[var(--br2)] hover:text-[var(--t2)] transition-colors disabled:opacity-40"
        >
          {p.label}
        </button>
      ))}
      {currentPlannedEnd && (
        <button
          onClick={clear}
          disabled={saving}
          className="px-2 py-0.5 text-[11px] rounded border border-[var(--br)] text-[var(--t4)] hover:border-[var(--bad)] hover:text-[var(--bad)] transition-colors disabled:opacity-40"
        >
          ×
        </button>
      )}
      <button
        onClick={onClose}
        className="px-2 py-0.5 text-[11px] text-[var(--t4)] hover:text-[var(--t2)] transition-colors"
      >
        Закрити
      </button>
    </div>
  );
}

// ── End shift confirm ───────────────────────────────────────────────────────

function EndShiftButton({
  shiftId,
  courierName,
  onEnded,
}: {
  shiftId: string;
  courierName: string;
  onEnded: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleEnd() {
    setLoading(true);
    try {
      await apiPost(`/api/v1/shifts/${shiftId}/end`);
      onEnded();
    } catch {
      setConfirming(false);
    } finally {
      setLoading(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-[var(--t3)]">Закрити зміну?</span>
        <button
          onClick={handleEnd}
          disabled={loading}
          className="px-2.5 py-1 text-xs bg-[rgba(239,68,68,0.12)] text-[var(--bad)] border border-[rgba(239,68,68,0.3)] rounded-[6px] hover:bg-[rgba(239,68,68,0.22)] transition-colors disabled:opacity-50"
        >
          {loading ? '...' : 'Так'}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={loading}
          className="px-2.5 py-1 text-xs text-[var(--t4)] border border-[var(--br)] rounded-[6px] hover:text-[var(--t2)] transition-colors disabled:opacity-50"
        >
          Ні
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="px-3 py-1.5 text-xs text-[var(--t3)] border border-[var(--br)] rounded-[6px] hover:border-[rgba(239,68,68,0.4)] hover:text-[var(--bad)] transition-colors"
      title={`Закрити зміну ${courierName}`}
    >
      Закрити зміну
    </button>
  );
}

// ── Main table ──────────────────────────────────────────────────────────────

interface Props {
  shifts: ActiveShiftWithCourier[];
  timezone: string;
}

export function ShiftsTable({ shifts: initial, timezone }: Props) {
  const [shifts, setShifts] = useState(initial);
  const [editingShift, setEditingShift] = useState<string | null>(null);

  function handlePlannedEndUpdated(shiftId: string, val: string | null) {
    setShifts((prev) =>
      prev.map((s) => (s.id === shiftId ? { ...s, planned_end_at: val } : s)),
    );
    setEditingShift(null);
  }

  function handleShiftEnded(shiftId: string) {
    setShifts((prev) => prev.filter((s) => s.id !== shiftId));
  }

  if (shifts.length === 0) {
    return (
      <div className="bg-[var(--sf)] border border-[var(--br)] rounded-lg px-6 py-12 text-center">
        <p className="text-[var(--t3)] text-sm">Немає активних змін</p>
        <p className="text-[var(--t4)] text-xs mt-1">Курʼєри розпочнуть зміни з мобільного додатку</p>
      </div>
    );
  }

  return (
    <div className="bg-[var(--sf)] border border-[var(--br)] rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--br)]">
            <th className="px-3 py-2.5 text-left text-[11px] font-semibold tracking-[0.05em] uppercase text-[var(--t4)]">
              Курʼєр
            </th>
            <th className="px-3 py-2.5 text-left text-[11px] font-semibold tracking-[0.05em] uppercase text-[var(--t4)]">
              Початок
            </th>
            <th className="px-3 py-2.5 text-left text-[11px] font-semibold tracking-[0.05em] uppercase text-[var(--t4)]">
              Тривалість
            </th>
            <th className="px-3 py-2.5 text-left text-[11px] font-semibold tracking-[0.05em] uppercase text-[var(--t4)]">
              Завершення
            </th>
            <th className="px-3 py-2.5 text-right text-[11px] font-semibold tracking-[0.05em] uppercase text-[var(--t4)]">
              Доставок
            </th>
            <th className="px-3 py-2.5 text-right text-[11px] font-semibold tracking-[0.05em] uppercase text-[var(--t4)]">
              Відстань
            </th>
            <th className="px-3 py-2.5 text-right text-[11px] font-semibold tracking-[0.05em] uppercase text-[var(--t4)]">
              Дії
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--br)]">
          {shifts.map((shift) => {
            const isEditing = editingShift === shift.id;
            const startedDate = new Date(shift.started_at);

            return (
              <tr
                key={shift.id}
                className="hover:bg-[var(--s2)] transition-colors"
              >
                {/* Courier */}
                <td className="px-3 py-2.5">
                  <div className="font-medium text-[var(--t1)]">{shift.courier.name}</div>
                  <div className="text-xs text-[var(--t4)] mono">{shift.courier.phone}</div>
                </td>

                {/* Start time */}
                <td className="px-3 py-2.5">
                  <span className="mono text-[var(--t2)] text-sm">
                    {startedDate.toLocaleTimeString('uk-UA', {
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: timezone,
                    })}
                  </span>
                  <div className="text-xs text-[var(--t4)] mono">
                    {startedDate.toLocaleDateString('uk-UA', {
                      day: '2-digit',
                      month: '2-digit',
                      timeZone: timezone,
                    })}
                  </div>
                </td>

                {/* Duration */}
                <td className="px-3 py-2.5">
                  <LiveDuration startedAt={shift.started_at} />
                </td>

                {/* Planned end */}
                <td className="px-3 py-2.5">
                  {isEditing ? (
                    <PlannedEndEditor
                      shiftId={shift.id}
                      currentPlannedEnd={shift.planned_end_at}
                      timezone={timezone}
                      onUpdated={(val) => handlePlannedEndUpdated(shift.id, val)}
                      onClose={() => setEditingShift(null)}
                    />
                  ) : (
                    <button
                      onClick={() => setEditingShift(shift.id)}
                      className={cn(
                        'text-sm mono transition-colors hover:text-[var(--t1)]',
                        shift.planned_end_at ? 'text-[var(--t2)]' : 'text-[var(--t4)]',
                      )}
                      title="Натисніть щоб змінити"
                    >
                      {shift.planned_end_at
                        ? new Date(shift.planned_end_at).toLocaleTimeString('uk-UA', {
                            hour: '2-digit',
                            minute: '2-digit',
                            timeZone: timezone,
                          })
                        : '—'}
                    </button>
                  )}
                </td>

                {/* Deliveries */}
                <td className="px-3 py-2.5 text-right">
                  <span className="mono text-[var(--t2)]">{shift.total_deliveries}</span>
                </td>

                {/* Distance */}
                <td className="px-3 py-2.5 text-right">
                  <span className="mono text-[var(--t3)] text-xs">
                    {shift.total_distance_km != null
                      ? `${shift.total_distance_km.toFixed(1)} км`
                      : '—'}
                  </span>
                </td>

                {/* Actions */}
                <td className="px-3 py-2.5 text-right">
                  <EndShiftButton
                    shiftId={shift.id}
                    courierName={shift.courier.name}
                    onEnded={() => handleShiftEnded(shift.id)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
