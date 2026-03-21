import { NextRequest, NextResponse } from 'next/server';

const API_BASE = process.env.API_INTERNAL_URL ?? 'http://localhost:3000';

export async function POST(req: NextRequest) {
  // Forward the refresh_token cookie to the NestJS backend
  const refreshToken = req.cookies.get('refresh_token')?.value;

  if (!refreshToken) {
    return NextResponse.json({ error: 'No refresh token' }, { status: 401 });
  }

  const res = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `refresh_token=${refreshToken}`,
    },
  });

  if (!res.ok) {
    const response = NextResponse.json({ error: 'Refresh failed' }, { status: 401 });
    response.cookies.delete('access_token');
    response.cookies.delete('refresh_token');
    return response;
  }

  const data = await res.json();
  const response = NextResponse.json({ ok: true });

  if (data.access_token) {
    response.cookies.set('access_token', data.access_token, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 15 * 60,
    });
  }

  const setCookieHeader = res.headers.get('set-cookie');
  if (setCookieHeader) {
    response.headers.append('set-cookie', setCookieHeader);
  }

  return response;
}
