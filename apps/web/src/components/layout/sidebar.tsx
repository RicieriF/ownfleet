'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useT, LocaleSwitcher } from '@/lib/i18n/client';
import {
  ClipboardList,
  Users,
  Map,
  BarChart2,
  Settings,
  Webhook,
  Plug,
  LogOut,
  CalendarClock,
  History,
  UsersRound,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/',              label: 'Замовлення',    icon: ClipboardList },
  { href: '/couriers',      label: 'Курʼєри',       icon: Users },
  { href: '/team',          label: 'Команда',       icon: UsersRound },
  { href: '/shifts',        label: 'Зміни',         icon: CalendarClock },
  { href: '/map',           label: 'Карта',          icon: Map },
  { href: '/history',       label: 'Історія',       icon: History },
  { href: '/analytics',     label: 'Аналітика',     icon: BarChart2 },
  { href: '/integrations',  label: 'Інтеграції',    icon: Plug },
  { href: '/webhooks',      label: 'Webhooks',      icon: Webhook },
  { href: '/settings',      label: 'Налаштування',  icon: Settings },
] as const;

interface SidebarProps {
  establishmentName?: string;
}

export function Sidebar({ establishmentName }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useT();

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <aside className="flex flex-col w-56 min-h-screen bg-[var(--sf)] border-r border-[var(--br)]">
      <div className="px-5 py-5 border-b border-[var(--br)]">
        <span className="text-lg font-bold tracking-tight text-[var(--t1)]">
          {establishmentName ?? 'OwnFleet'}
        </span>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
              pathname === href
                ? 'bg-[var(--acm-m)] text-[var(--t1)] border border-[var(--acm-b)]'
                : 'text-[var(--t3)] hover:bg-[var(--s2)] hover:text-[var(--t1)] border border-transparent',
            )}
          >
            <Icon size={16} strokeWidth={1.75} />
            {t(label)}
          </Link>
        ))}
      </nav>

      <div className="flex items-center justify-between px-3 py-4 border-t border-[var(--br)]">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-[var(--t3)] hover:bg-[var(--s2)] hover:text-[var(--bad)] transition-colors border border-transparent"
        >
          <LogOut size={16} strokeWidth={1.75} />
          {t('Вийти')}
        </button>
        <div className="pr-2">
          <LocaleSwitcher />
        </div>
      </div>
    </aside>
  );
}
