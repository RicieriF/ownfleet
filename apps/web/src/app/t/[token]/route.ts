/**
 * Short URL redirect: /t/:token → /embed/track/:token
 * Managers send clients this short link. 301 — cacheable.
 */
import { redirect } from 'next/navigation';

interface RouteParams {
  params: Promise<{ token: string }>;
}

export async function GET(_req: Request, { params }: RouteParams) {
  const { token } = await params;
  redirect(`/embed/track/${token}`);
}
