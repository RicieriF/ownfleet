/**
 * Short URL redirect: /t/:token → /embed/track/:token
 * Managers send clients this short link. 301 Permanent — cacheable by browsers.
 */
import { NextResponse } from 'next/server';

interface RouteParams {
  params: Promise<{ token: string }>;
}

export async function GET(req: Request, { params }: RouteParams) {
  const { token } = await params;
  const url = new URL(`/embed/track/${token}`, req.url);
  return NextResponse.redirect(url, 301);
}
