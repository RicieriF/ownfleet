'use client';

import { useState, useEffect } from 'react';
import { CourierWithStatus, CourierStatus, CourierMovedEvent } from '@/types';
import { getSocket } from '@/lib/socket';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { uk } from 'date-fns/locale';
import { apiPost } from '@/lib/api-client';

const STATUS_CONFIG: Record<CourierStatus, { dot: string; label: string; labelColor: string }> = {
  online:         { dot: 'bg-[var(--ok)]',   label: 'На зміні',      labelColor: 'text-[var(--ok)]' },
  background:     { dot: 'bg-[var(--warn)]',  label: 'Фон',           labelColor: 'text-[var(--warn)]' },
  not_responding: { dot: 'bg-[var(--bad)]',   label: 'Не відповідає', labelColor: 'text-[var(--bad)]' },
  offline:        { dot: 'bg-[var(--t4)]',    label: 'Офлайн',        labelColor: 'text-[var(--t4)]' },
};

interface Props {
  couriers: CourierWithStatus[];
}

export function CouriersList({ couriers: initial }: Props) {
  const [couriers, setCouriers] = useState(initial);
  const [remindLoading, setRemindLoading] = useState<string | null>(null);

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

    return () => {
      socket.off('courier:moved');
    };
  }, []);

  async function handleRemind(courierId: string) {
    setRemindLoading(courierId);
    try {
      await apiPost(`/api/v1/couriers/${courierId}/remind`);
    } catch {
      // fire-and-forget
    } finally {
      setRemindLoading(null);
    }
  }

  return (
    <div className="grid gap-2">
      {couriers.map((courier) => {
        const config = STATUS_CONFIG[courier.status];
        return (
          <div
            key={courier.id}
            className="bg-[var(--sf)] rounded-lg border border-[var(--br)] px-4 py-3 flex items-center gap-4 card-shine"
          >
            {/* Status dot — pulse only on danger/background per design system */}
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
                <span className="text-xs text-[var(--t4)] mono">{courier.phone}</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={cn('text-xs font-medium', config.labelColor)}>
                  {config.label}
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
                  <span className="text-xs text-[var(--t4)] italic">неактивний</span>
                )}
              </div>
            </div>

            {/* Remind button — only for not_responding */}
            {courier.status === 'not_responding' && (
              <button
                onClick={() => handleRemind(courier.id)}
                disabled={remindLoading === courier.id}
                className="px-3 py-1.5 text-xs bg-[rgba(239,68,68,0.1)] text-[var(--bad)] border border-[rgba(239,68,68,0.25)] rounded-[6px] hover:bg-[rgba(239,68,68,0.2)] transition-colors disabled:opacity-50"
              >
                {remindLoading === courier.id ? 'Надсилання...' : 'Нагадати'}
              </button>
            )}
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
