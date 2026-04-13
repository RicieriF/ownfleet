'use client';

import { useState } from 'react';
import { apiPost } from '@/lib/api-client';
import type { CourierWithStatus } from '@/types';

const STATUS_DOT: Record<string, string> = {
  online:         'var(--ok)',
  background:     'var(--warn)',
  not_responding: 'var(--bad)',
  offline:        'var(--t4)',
};

const STATUS_LABEL: Record<string, string> = {
  online:         'Онлайн',
  background:     'Фон',
  not_responding: 'Не відповідає',
  offline:        'Офлайн',
};

interface Props {
  couriers: CourierWithStatus[];
}

export function CourierStatusPanel({ couriers }: Props) {
  const [remindingId, setRemindingId] = useState<string | null>(null);
  const [remindedIds, setRemindedIds] = useState<Set<string>>(new Set());

  async function handleRemind(courierId: string) {
    setRemindingId(courierId);
    try {
      await apiPost(`/api/v1/couriers/${courierId}/remind`);
      setRemindedIds((prev) => new Set([...prev, courierId]));
    } catch {
      // Telegram is fire-and-forget; silent failure is acceptable
    } finally {
      setRemindingId(null);
    }
  }

  const activeCouriers = couriers.filter((c) => c.active);
  const onShiftCount = activeCouriers.filter((c) => c.on_shift).length;

  return (
    <div
      style={{
        background: 'var(--sf)',
        border: '1px solid var(--br)',
        borderRadius: '8px',
        boxShadow: 'var(--shadow-edge)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 12px',
          borderBottom: '1px solid var(--br)',
        }}
      >
        <span
          style={{
            fontSize: '11px',
            fontWeight: 500,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--t4)',
          }}
        >
          Курʼєри
        </span>
        <span className="mono" style={{ fontSize: '12px', color: 'var(--t3)' }}>
          {onShiftCount}/{activeCouriers.length} на зміні
        </span>
      </div>

      {activeCouriers.length === 0 ? (
        <div style={{ padding: '16px 12px', fontSize: '13px', color: 'var(--t3)' }}>
          Немає активних курʼєрів
        </div>
      ) : (
        <div>
          {activeCouriers.map((courier, i) => {
            const isNotStarted = !courier.on_shift;
            const isReminded = remindedIds.has(courier.id);
            const isReminding = remindingId === courier.id;

            return (
              <div
                key={courier.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 12px',
                  borderTop: i > 0 ? '1px solid var(--br)' : undefined,
                }}
              >
                <span
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: isNotStarted ? 'var(--t4)' : STATUS_DOT[courier.status],
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    flex: 1,
                    fontSize: '13px',
                    color: isNotStarted ? 'var(--t3)' : 'var(--t2)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {courier.name}
                </span>

                {isNotStarted ? (
                  <button
                    onClick={() => handleRemind(courier.id)}
                    disabled={isReminding || isReminded}
                    className="transition-colors disabled:opacity-60"
                    style={{
                      padding: '2px 8px',
                      fontSize: '11px',
                      borderRadius: '5px',
                      background: isReminded ? 'var(--acm-m)' : 'var(--s2)',
                      color: isReminded ? 'var(--t2)' : 'var(--t4)',
                      border: `1px solid ${isReminded ? 'var(--acm-b)' : 'var(--br)'}`,
                      cursor: isReminding || isReminded ? 'default' : 'pointer',
                      flexShrink: 0,
                      whiteSpace: 'nowrap',
                    }}
                    onMouseEnter={(e) => {
                      if (!isReminding && !isReminded) {
                        const el = e.currentTarget as HTMLButtonElement;
                        el.style.background = 'var(--s3)';
                        el.style.color = 'var(--t1)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isReminding && !isReminded) {
                        const el = e.currentTarget as HTMLButtonElement;
                        el.style.background = 'var(--s2)';
                        el.style.color = 'var(--t4)';
                      }
                    }}
                  >
                    {isReminding ? '…' : isReminded ? '✓' : 'Нагадати'}
                  </button>
                ) : (
                  <span style={{ fontSize: '11px', color: 'var(--t4)', flexShrink: 0 }}>
                    {STATUS_LABEL[courier.status]}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
