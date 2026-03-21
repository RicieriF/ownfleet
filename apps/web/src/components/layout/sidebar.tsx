'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/', label: 'Замовлення', icon: '📦' },
  { href: '/couriers', label: 'Курʼєри', icon: '🛵' },
  { href: '/map', label: 'Карта', icon: '🗺️' },
  { href: '/analytics', label: 'Аналітика', icon: '📊' },
  { href: '/settings', label: 'Налаштування', icon: '⚙️' },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <aside className="flex flex-col w-56 min-h-screen bg-gray-900 text-gray-100">
      <div className="px-5 py-5 border-b border-gray-700">
        <span className="text-lg font-bold tracking-tight">Weego CMI</span>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map(({ href, label, icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
              pathname === href
                ? 'bg-blue-600 text-white'
                : 'text-gray-300 hover:bg-gray-800 hover:text-white',
            )}
          >
            <span>{icon}</span>
            {label}
          </Link>
        ))}
      </nav>

      <div className="px-3 py-4 border-t border-gray-700">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2 w-full rounded-lg text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
        >
          <span>🚪</span>
          Вийти
        </button>
      </div>
    </aside>
  );
}
