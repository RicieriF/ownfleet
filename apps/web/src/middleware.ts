import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/login', '/api/auth/login'];

// Public embed routes — no auth required, iframeable by any site
const EMBED_PATHS = ['/embed/track/', '/t/'];

const EMBED_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com",
  "connect-src 'self' wss: https://*.openstreetmap.org https://*.basemaps.cartocdn.com",
  "frame-ancestors *",
].join('; ');

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Embed pages: bypass auth + set security headers
  if (EMBED_PATHS.some((p) => pathname.startsWith(p))) {
    const res = NextResponse.next();
    res.headers.set('Content-Security-Policy', EMBED_CSP);
    res.headers.set('X-Content-Type-Options', 'nosniff');
    res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    // Explicitly remove X-Frame-Options to allow iframe embedding
    res.headers.delete('X-Frame-Options');
    return res;
  }

  // Allow public paths and Next.js internals
  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get('access_token')?.value;

  if (!token) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = '/login';
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
