/**
 * Redirect route: GET /t/:token → 301 → /embed/track/:token
 */

import { describe, it, expect } from 'vitest';
import { GET } from '../route';

describe('GET /t/[token]', () => {
  it('redirects to /embed/track/:token with 301', async () => {
    const req = new Request('https://ownfleet.app/t/abc123');
    const res = await GET(req, { params: Promise.resolve({ token: 'abc123' }) });

    expect(res.status).toBe(301);
    const location = res.headers.get('location');
    expect(location).toContain('/embed/track/abc123');
  });

  it('preserves the full token in the redirect location', async () => {
    const token = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const req = new Request(`https://ownfleet.app/t/${token}`);
    const res = await GET(req, { params: Promise.resolve({ token }) });

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toContain(`/embed/track/${token}`);
  });
});
