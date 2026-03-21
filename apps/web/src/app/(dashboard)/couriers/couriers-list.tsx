'use client';

import { useState, useEffect } from 'react';
import { CourierWithStatus, CourierStatus, CourierMovedEvent } from '@/types';
import { getSocket } from '@/lib/socket';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { uk } from 'date-fns/locale';
import { apiPost } from '@/lib/api-client';

const STATUS_CONFIG: Record<CourierStatus, { dot: string; label: string }> = {
  online: { dot: 'bg-green-500', label: 'Онлайн' },
  background: { dot: 'bg-yellow-400', label: 'Фон' },
  not_responding: { dot: 'bg-red-500', label: 'Не відповідає' },
  offline: { dot: 'bg-gray-400', label: 'Офлайн' },
};

interface Props {
  couriers: CourierWithStatus[];
}

export function CouriersList({ couriers: initial }: Props) {
  const [couriers, setCouriers] = useState(initial);
  const [remindLoading, setRemindLoading] = useState<string | null>(null);

  useEffect(() => {
    const socket = getSocket();

    // Update last_ping_at and position when a courier pings
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
      // Ignore — fire-and-forget reminder
    } finally {
      setRemindLoading(null);
    }
  }

  return (
    <div className="grid gap-3">
      {couriers.map((courier) => {
        const config = STATUS_CONFIG[courier.status];
        return (
          <div
            key={courier.id}
            className="bg-white rounded-xl border border-gray-200 px-5 py-4 flex items-center gap-4"
          >
            {/* Status dot */}
            <div className="relative">
              <div className={cn('w-3 h-3 rounded-full', config.dot)} />
              {courier.status === 'online' && (
                <div
                  className={cn(
                    'absolute inset-0 w-3 h-3 rounded-full animate-ping opacity-60',
                    config.dot,
                  )}
                />
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900">{courier.name}</span>
                <span className="text-xs text-gray-500">{courier.phone}</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span
                  className={cn(
                    'text-xs font-medium',
                    courier.status === 'online'
                      ? 'text-green-600'
                      : courier.status === 'background'
                        ? 'text-yellow-600'
                        : courier.status === 'not_responding'
                          ? 'text-red-600'
                          : 'text-gray-500',
                  )}
                >
                  {config.label}
                </span>
                {courier.last_ping_at && (
                  <span className="text-xs text-gray-400">
                    •{' '}
                    {formatDistanceToNow(new Date(courier.last_ping_at), {
                      addSuffix: true,
                      locale: uk,
                    })}
                  </span>
                )}
                {!courier.active && (
                  <span className="text-xs text-gray-400 italic">неактивний</span>
                )}
              </div>
            </div>

            {/* Remind button for not_responding couriers */}
            {courier.status === 'not_responding' && (
              <button
                onClick={() => handleRemind(courier.id)}
                disabled={remindLoading === courier.id}
                className="px-3 py-1.5 text-xs bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-60"
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
  // Keep not_responding only if courier was not_responding before — simplified rule
  return courier.status === 'not_responding' ? 'not_responding' : 'offline';
}
