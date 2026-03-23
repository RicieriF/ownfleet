'use client';

import { useState, useTransition } from 'react';
import { Courier, InviteToken } from '@/types';
import { apiPost, apiDelete } from '@/lib/api-client';
import { formatDistanceToNow, isPast } from 'date-fns';
import { uk } from 'date-fns/locale';

interface Props {
  couriers: Pick<Courier, 'id' | 'name'>[];
  initialInvites: InviteToken[];
}

function statusOf(invite: InviteToken): 'used' | 'expired' | 'active' {
  if (invite.used_at) return 'used';
  if (isPast(new Date(invite.expires_at))) return 'expired';
  return 'active';
}

const STATUS_STYLES = {
  active:  'bg-[var(--acm-m)] text-[var(--acm)] border border-[var(--acm-b)]',
  used:    'bg-[rgba(34,197,94,0.12)] text-[var(--ok)] border border-[rgba(34,197,94,0.25)]',
  expired: 'bg-[var(--s1)] text-[var(--t4)] border border-[var(--br)]',
};

const STATUS_LABELS = {
  active:  'Активне',
  used:    'Прийнято',
  expired: 'Прострочено',
};

export function InvitePanel({ couriers, initialInvites }: Props) {
  const [invites, setInvites] = useState<InviteToken[]>(initialInvites);
  const [selectedCourierId, setSelectedCourierId] = useState('');
  const [newToken, setNewToken] = useState<{ token: string; expires_at: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  function handleCreate() {
    if (!selectedCourierId) return;
    setError('');
    startTransition(async () => {
      try {
        const result = await apiPost<{ id: string; token: string; courier_id: string; expires_at: string }>(
          '/api/v1/onboarding/invites',
          { courier_id: selectedCourierId },
        );
        const courier = couriers.find((c) => c.id === selectedCourierId);
        setInvites((prev) => [
          {
            ...result,
            created_at: new Date().toISOString(),
            used_at: null,
            courier: { name: courier?.name ?? '' },
          },
          ...prev,
        ]);
        setNewToken({ token: result.token, expires_at: result.expires_at });
        setSelectedCourierId('');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Помилка створення запрошення');
      }
    });
  }

  function handleRevoke(id: string) {
    startTransition(async () => {
      try {
        await apiDelete(`/api/v1/onboarding/invites/${id}`);
        setInvites((prev) => prev.filter((i) => i.id !== id));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Помилка скасування');
      }
    });
  }

  function handleCopy(token: string) {
    void navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const activeInvites = invites.filter((i) => statusOf(i) !== 'expired');

  return (
    <div
      className="rounded-lg mt-6"
      style={{
        background: 'var(--s2)',
        border: '1px solid var(--br)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
      }}
    >
      {/* Header */}
      <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--br)' }}>
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--t1)' }}>Запросити курʼєра</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--t4)' }}>
            Токен діє 24 години. Курʼєр вводить його при першому відкритті застосунку.
          </p>
        </div>
      </div>

      {/* Create form */}
      <div className="px-5 py-4 border-b flex flex-wrap items-end gap-3" style={{ borderColor: 'var(--br)' }}>
        <div className="flex-1 min-w-[200px]">
          <label className="block mb-1" style={{ color: 'var(--t4)', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Курʼєр
          </label>
          <select
            value={selectedCourierId}
            onChange={(e) => setSelectedCourierId(e.target.value)}
            className="w-full text-sm rounded outline-none"
            style={{
              background: 'var(--s1)',
              border: '1px solid var(--br)',
              color: selectedCourierId ? 'var(--t1)' : 'var(--t4)',
              padding: '6px 10px',
              borderRadius: '6px',
            }}
            onFocus={(e) => (e.currentTarget.style.boxShadow = '0 0 0 1px var(--bg), 0 0 0 3px #6aaa84')}
            onBlur={(e) => (e.currentTarget.style.boxShadow = 'none')}
          >
            <option value="">Оберіть курʼєра...</option>
            {couriers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <button
          onClick={handleCreate}
          disabled={!selectedCourierId || isPending}
          className="text-sm font-medium rounded transition-opacity disabled:opacity-40"
          style={{ background: '#6aaa84', color: '#09090b', padding: '6px 16px', borderRadius: '6px' }}
        >
          {isPending ? 'Створюємо…' : 'Створити токен'}
        </button>
        {error && <p className="w-full text-xs" style={{ color: 'var(--bad)' }}>{error}</p>}
      </div>

      {/* New token banner */}
      {newToken && (
        <div
          className="mx-5 my-4 px-4 py-3 rounded-md flex items-center justify-between gap-4"
          style={{ background: 'rgba(106,170,132,0.1)', border: '1px solid rgba(106,170,132,0.3)' }}
        >
          <div className="min-w-0">
            <p className="text-xs font-medium mb-1" style={{ color: 'var(--acm)' }}>Токен створено</p>
            <p
              className="text-sm break-all"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--t1)' }}
            >
              {newToken.token}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--t4)' }}>
              Дійсний до{' '}
              <span style={{ fontFamily: 'var(--font-mono)' }}>
                {new Date(newToken.expires_at).toLocaleString('uk-UA', {
                  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                })}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => handleCopy(newToken.token)}
              className="text-xs font-medium px-3 py-1.5 rounded"
              style={{ background: 'var(--s2)', border: '1px solid var(--br)', color: 'var(--t2)', borderRadius: '6px' }}
            >
              {copied ? 'Скопійовано ✓' : 'Скопіювати'}
            </button>
            <button
              onClick={() => setNewToken(null)}
              className="text-xs"
              style={{ color: 'var(--t4)' }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Invites list */}
      {activeInvites.length === 0 ? (
        <div className="px-5 py-6 text-center text-sm" style={{ color: 'var(--t4)' }}>
          Немає активних запрошень
        </div>
      ) : (
        <div className="divide-y" style={{ borderColor: 'var(--br)' }}>
          {activeInvites.map((invite) => {
            const st = statusOf(invite);
            return (
              <div key={invite.id} className="px-5 py-3 flex items-center gap-4">
                {/* Courier name */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--t1)' }}>
                    {invite.courier.name}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--t4)', fontFamily: 'var(--font-mono)' }}>
                    {invite.token.slice(0, 12)}…
                  </p>
                </div>

                {/* Expiry */}
                <span className="text-xs hidden sm:block" style={{ color: 'var(--t4)' }}>
                  {st === 'used'
                    ? 'Прийнято'
                    : `${formatDistanceToNow(new Date(invite.expires_at), { locale: uk, addSuffix: true })}`}
                </span>

                {/* Status badge */}
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_STYLES[st]}`}>
                  {STATUS_LABELS[st]}
                </span>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {st === 'active' && (
                    <>
                      <button
                        onClick={() => handleCopy(invite.token)}
                        className="text-xs px-2 py-1 rounded"
                        style={{ background: 'var(--s1)', border: '1px solid var(--br)', color: 'var(--t3)', borderRadius: '4px' }}
                        title="Скопіювати токен"
                      >
                        Копія
                      </button>
                      <button
                        onClick={() => handleRevoke(invite.id)}
                        disabled={isPending}
                        className="text-xs px-2 py-1 rounded disabled:opacity-40"
                        style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: 'var(--bad)', borderRadius: '4px' }}
                        title="Скасувати запрошення"
                      >
                        Скасувати
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
