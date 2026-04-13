import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { apiFetch } from '@/lib/api';
import type { Establishment } from '@/types';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  let establishmentName: string | undefined;
  try {
    const est = await apiFetch<Establishment>('/api/v1/establishments/me');
    establishmentName = est.name;
  } catch {
    // Non-critical: layout renders without establishment name if fetch fails
  }

  return (
    <div className="flex min-h-screen bg-[var(--bg)]">
      <Sidebar establishmentName={establishmentName} />
      <div className="flex flex-col flex-1 overflow-hidden min-h-screen">
        <Topbar />
        <main className="flex-1 overflow-auto">
          <div className="p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
