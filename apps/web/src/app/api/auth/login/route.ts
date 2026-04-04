import { NextRequest, NextResponse } from 'next/server';

const API_BASE = process.env.API_INTERNAL_URL ?? 'http://localhost:3000';

export async function POST(req: NextRequest) {
  const body = await req.json();

  const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let error = 'Невірний email або пароль';
    if (body) {
      try {
        const json = JSON.parse(body) as { message?: unknown; error?: string };
        const raw = json.message;
        error = Array.isArray(raw) ? raw.join(', ') : (typeof raw === 'string' ? raw : json.error ?? error);
      } catch {
        error = body || error;
      }
    }
    return NextResponse.json({ error }, { status: res.status });
  }

  const data = await res.json();

  const response = NextResponse.json({ ok: true, user: data.user });

  if (data.access_token) {
    response.cookies.set('access_token', data.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 15 * 60, // 15 min — matches JWT expiry
    });
  }

  // Forward refresh_token as httpOnly cookie from NestJS (if set)
  const setCookieHeader = res.headers.get('set-cookie');
  if (setCookieHeader) {
    response.headers.append('set-cookie', setCookieHeader);
  }

  return response;
}
