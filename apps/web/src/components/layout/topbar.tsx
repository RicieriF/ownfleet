'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Order } from '@/types';
import { useT } from '@/lib/i18n/client';

const PAGE_TITLES: Record<string, string> = {
  '/':             'Дашборд',
  '/couriers':     'Курʼєри',
  '/team':         'Команда',
  '/shifts':       'Зміни',
  '/map':          'Карта',
  '/history':      'Історія',
  '/analytics':    'Аналітика',
  '/integrations': 'Інтеграції',
  '/webhooks':     'Webhooks',
  '/settings':     'Налаштування',
};

/**
 * LIVE pill — shown only on the main dashboard.
 * Checks for active deliveries on mount; hides if none exist.
 * Resolves the "always-green = always misleading" problem.
 */
function LivePill() {
  const [active, setActive] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/v1/orders?status=assigned,in_progress&limit=1')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Order[]) => setActive(data.length > 0))
      .catch(() => setActive(false));
  }, []);

  if (active === null || !active) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
        padding: '3px 8px',
        borderRadius: '4px',
        background: 'var(--s2)',
        border: '1px solid var(--br)',
      }}
    >
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: 'var(--ok)',
          display: 'block',
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontSize: '11px',
          fontWeight: 500,
          letterSpacing: '0.04em',
          color: 'var(--t3)',
        }}
      >
        LIVE
      </span>
    </div>
  );
}

export function Topbar() {
  const pathname = usePathname();
  const t = useT();
  const title = t(PAGE_TITLES[pathname] ?? 'OwnFleet');
  const isMainDashboard = pathname === '/';

  return (
    <header
      style={{
        height: '48px',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        background: 'var(--sf)',
        borderBottom: '1px solid var(--br)',
      }}
    >
      <span
        style={{
          fontSize: '14px',
          fontWeight: 600,
          color: 'var(--t1)',
          letterSpacing: '-0.01em',
        }}
      >
        {title}
      </span>

      {isMainDashboard && <LivePill />}
    </header>
  );
}
