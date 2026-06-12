'use client';

import Link from 'next/link';
import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { uk, enUS } from 'date-fns/locale';
import { apiPost } from '@/lib/api-client';
import type { CourierWithStatus, Order } from '@/types';
import { useT, useLocale } from '@/lib/i18n/client';

interface AlertCardProps {
  courier: Pick<CourierWithStatus, 'id' | 'name' | 'last_ping_at'>;
  order: Pick<Order, 'address'>;
}

export function AlertCard({ courier, order }: AlertCardProps) {
  const t = useT();
  const dateLocale = useLocale() === 'uk' ? uk : enUS;
  const [reminding, setReminding] = useState(false);
  const [reminded, setReminded] = useState(false);

  async function handleRemind() {
    setReminding(true);
    try {
      await apiPost(`/api/v1/couriers/${courier.id}/remind`);
      setReminded(true);
    } catch {
      // Telegram is fire-and-forget; silent failure is acceptable
    } finally {
      setReminding(false);
    }
  }

  return (
    <div
      className="flex items-start gap-3 mb-3 px-4 py-3 rounded-md"
      style={{
        background: 'var(--bad-tint)',
        border: '1px solid var(--bad-border)',
        borderLeft: '3px solid var(--bad)',
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--bad)"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0, marginTop: '1px' }}
      >
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--t1)' }}>
          {courier.name} {t('не відповідає')}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--t3)', marginTop: '2px' }}>
          {t('Активна доставка')} · {order.address}
          {courier.last_ping_at && (
            <>
              {' · ' + t('пінг') + ' '}
              {formatDistanceToNow(new Date(courier.last_ping_at), {
                addSuffix: true,
                locale: dateLocale,
              })}
            </>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '6px', flexShrink: 0, alignItems: 'center' }}>
        <button
          onClick={handleRemind}
          disabled={reminding || reminded}
          className="transition-colors disabled:opacity-60"
          style={{
            padding: '4px 10px',
            fontSize: '12px',
            borderRadius: '6px',
            background: reminded ? 'var(--acm-m)' : 'var(--s2)',
            color: reminded ? 'var(--t2)' : 'var(--t3)',
            border: `1px solid ${reminded ? 'var(--acm-b)' : 'var(--br)'}`,
            cursor: reminding || reminded ? 'default' : 'pointer',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={(e) => {
            if (!reminding && !reminded) {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.background = 'var(--s3)';
              el.style.color = 'var(--t1)';
            }
          }}
          onMouseLeave={(e) => {
            if (!reminding && !reminded) {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.background = 'var(--s2)';
              el.style.color = 'var(--t3)';
            }
          }}
        >
          {reminding ? '…' : reminded ? t('✓ Надіслано') : t('Нагадати')}
        </button>

        <Link
          href="/map"
          style={{
            padding: '4px 10px',
            fontSize: '12px',
            borderRadius: '6px',
            background: 'transparent',
            color: 'var(--t3)',
            border: '1px solid transparent',
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.color = 'var(--t1)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.color = 'var(--t3)';
          }}
        >
          {t('На карті →')}
        </Link>
      </div>
    </div>
  );
}
