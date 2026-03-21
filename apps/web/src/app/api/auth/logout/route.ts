import { NextRequest, NextResponse } from 'next/server';

const API_BASE = process.env.API_INTERNAL_URL ?? 'http://localhost:3000';

export async function POST(req: NextRequest) {
  const refreshToken = req.cookies.get('refresh_token')?.value;

  // Best-effort logout on backend (fire-and-forget style)
  if (refreshToken) {
    fetch(`${API_BASE}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { Cookie: `refresh_token=${refreshToken}` },
    }).catch(() => {
      // Ignore — we clear cookies regardless
    });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.delete('access_token');
  response.cookies.delete('refresh_token');
  return response;
}
