import { cookies } from 'next/headers';
import { apiFetch } from '@/lib/api';
import { TeamMember } from '@/types';
import { TeamManager } from './team-manager';

/** Decode JWT payload to read role — verification is done by the API, not here. */
async function getUserRole(): Promise<string | null> {
  const store = await cookies();
  const token = store.get('access_token')?.value;
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as { role?: string };
    return payload.role ?? null;
  } catch {
    return null;
  }
}

export default async function TeamPage() {
  const [members, role] = await Promise.all([
    apiFetch<TeamMember[]>('/api/v1/team'),
    getUserRole(),
  ]);

  return (
    <TeamManager
      initialMembers={members}
      isOwner={role === 'owner'}
    />
  );
}
