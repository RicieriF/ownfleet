import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { ApiError } from '@/lib/api';
import { LogOut, Shield } from 'lucide-react';
import Link from 'next/link';

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  // Guard: only platform admins can access /platform
  // We verify by calling a protected endpoint — 403 means not platform admin
  try {
    await apiFetch('/api/v1/platform/establishments');
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      redirect('/login');
    }
    // Other errors (network, 500) — let the page handle
  }

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 h-12 border-b border-[var(--br)] bg-[var(--sf)]">
        <div className="flex items-center gap-2.5">
          <Shield size={14} className="text-[var(--acm)]" strokeWidth={2} />
          <span className="text-sm font-semibold text-[var(--t1)] tracking-tight">
            Weego Platform
          </span>
          <span className="text-[var(--br2)] text-xs">|</span>
          <span className="text-xs text-[var(--t4)] font-mono">admin</span>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-xs text-[var(--t4)] hover:text-[var(--t2)] transition-colors"
          >
            ← Назад до дашборду
          </Link>
          <form action="/api/auth/logout" method="POST">
            <button
              type="submit"
              className="flex items-center gap-1.5 text-xs text-[var(--t4)] hover:text-[var(--bad)] transition-colors"
            >
              <LogOut size={12} strokeWidth={2} />
              Вийти
            </button>
          </form>
        </div>
      </header>

      <main className="p-6">{children}</main>
    </div>
  );
}
