'use client';

import { useState, useTransition } from 'react';
import { TeamMember } from '@/types';
import { apiPost, apiPatch, apiDelete } from '@/lib/api-client';
import { UserPlus, Trash2, RefreshCw } from 'lucide-react';

interface Props {
  initialMembers: TeamMember[];
  isOwner: boolean;
}

const emptyForm = { email: '', password: '' };

export function TeamManager({ initialMembers, isOwner }: Props) {
  const [members, setMembers] = useState<TeamMember[]>(initialMembers);
  const [form, setForm] = useState(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [isPending, startTransition] = useTransition();

  function handleCreate() {
    if (!form.email || form.password.length < 6) return;
    setError('');
    startTransition(async () => {
      try {
        const member = await apiPost<TeamMember>('/api/v1/team', form);
        setMembers((prev) => [...prev, member]);
        setForm(emptyForm);
        setFormOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Помилка створення');
      }
    });
  }

  function handleUpdate() {
    if (!editId || newPassword.length < 6) return;
    setError('');
    startTransition(async () => {
      try {
        await apiPatch(`/api/v1/team/${editId}`, { password: newPassword });
        setEditId(null);
        setNewPassword('');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Помилка оновлення');
      }
    });
  }

  function handleDelete(id: string, email: string) {
    if (!confirm(`Видалити ${email}?`)) return;
    setError('');
    startTransition(async () => {
      try {
        await apiDelete(`/api/v1/team/${id}`);
        setMembers((prev) => prev.filter((m) => m.id !== id));
        if (editId === id) setEditId(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Помилка видалення');
      }
    });
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--t1)]">Команда</h1>
          <p className="text-sm text-[var(--t3)] mt-0.5">
            {members.length === 0
              ? 'Немає учасників'
              : `${members.length} ${members.length === 1 ? 'менеджер' : 'менеджерів'}`}
          </p>
        </div>
        {isOwner && (
          <button
            onClick={() => { setFormOpen((o) => !o); setError(''); }}
            className="flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-md transition-colors"
            style={{
              background: formOpen ? 'var(--s2)' : 'var(--acm)',
              color: 'var(--t1)',
              border: '1px solid var(--br)',
              borderRadius: '6px',
            }}
          >
            <UserPlus size={15} strokeWidth={1.75} />
            Додати менеджера
          </button>
        )}
      </div>

      {/* Add form */}
      {formOpen && isOwner && (
        <div
          className="rounded-lg"
          style={{
            background: 'var(--s2)',
            border: '1px solid var(--br)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
          }}
        >
          <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--br)' }}>
            <p className="text-sm font-semibold text-[var(--t1)]">Новий менеджер</p>
            <p className="text-xs mt-0.5 text-[var(--t3)]">Менеджер матиме повний доступ до дашборду вашого закладу.</p>
          </div>

          <div className="px-5 py-4 flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <label className="block mb-1" style={{ color: 'var(--t4)', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Email
              </label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="manager@example.com"
                className="w-full text-sm rounded outline-none"
                style={{ background: 'var(--s1)', border: '1px solid var(--br)', color: 'var(--t1)', padding: '6px 10px', borderRadius: '6px' }}
                onFocus={(e) => (e.currentTarget.style.boxShadow = '0 0 0 1px var(--bg), 0 0 0 2px rgba(250,249,246,0.25)')}
                onBlur={(e) => (e.currentTarget.style.boxShadow = 'none')}
              />
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="block mb-1" style={{ color: 'var(--t4)', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Пароль
              </label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Мінімум 6 символів"
                className="w-full text-sm rounded outline-none"
                style={{ background: 'var(--s1)', border: '1px solid var(--br)', color: 'var(--t1)', padding: '6px 10px', borderRadius: '6px' }}
                onFocus={(e) => (e.currentTarget.style.boxShadow = '0 0 0 1px var(--bg), 0 0 0 2px rgba(250,249,246,0.25)')}
                onBlur={(e) => (e.currentTarget.style.boxShadow = 'none')}
              />
            </div>
          </div>

          <div className="px-5 pb-4 flex items-center gap-3">
            <button
              onClick={handleCreate}
              disabled={!form.email || form.password.length < 6 || isPending}
              className="text-sm font-medium px-4 py-2 rounded-md transition-opacity disabled:opacity-40"
              style={{ background: 'var(--acm)', color: 'var(--t1)', borderRadius: '6px' }}
            >
              {isPending ? 'Створюємо…' : 'Створити акаунт'}
            </button>
            <button
              onClick={() => { setFormOpen(false); setForm(emptyForm); setError(''); }}
              className="text-sm text-[var(--t3)] hover:text-[var(--t1)] transition-colors"
            >
              Скасувати
            </button>
            {error && <p className="text-xs text-[var(--bad)]">{error}</p>}
          </div>
        </div>
      )}

      {/* Members list */}
      {members.length === 0 ? (
        <div
          className="rounded-lg px-6 py-12 text-center"
          style={{ background: 'var(--s2)', border: '1px solid var(--br)' }}
        >
          <p className="text-sm text-[var(--t3)]">
            {isOwner ? 'Натисніть «Додати менеджера», щоб надати доступ до дашборду.' : 'Менеджерів ще немає.'}
          </p>
        </div>
      ) : (
        <div
          className="rounded-lg overflow-hidden"
          style={{
            background: 'var(--s2)',
            border: '1px solid var(--br)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
          }}
        >
          {/* Table header */}
          <div
            className="grid px-5 py-2.5 border-b"
            style={{
              gridTemplateColumns: '1fr auto',
              borderColor: 'var(--br)',
              color: 'var(--t4)',
              fontSize: '11px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            <span>Email</span>
            <span>Додано</span>
          </div>

          <div className="divide-y" style={{ borderColor: 'var(--br)' }}>
            {members.map((m) => (
              <div key={m.id} className="px-5 py-3">
                {editId === m.id ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm text-[var(--t1)] flex-1 min-w-[160px]">{m.email}</span>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Новий пароль (мін. 6)"
                      className="text-sm rounded outline-none w-48"
                      style={{ background: 'var(--s1)', border: '1px solid var(--br)', color: 'var(--t1)', padding: '4px 8px', borderRadius: '6px' }}
                      autoFocus
                    />
                    <button
                      onClick={handleUpdate}
                      disabled={newPassword.length < 6 || isPending}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded disabled:opacity-40"
                      style={{ background: 'var(--acm)', color: 'var(--t1)', borderRadius: '6px' }}
                    >
                      <RefreshCw size={12} />
                      Зберегти
                    </button>
                    <button
                      onClick={() => { setEditId(null); setError(''); }}
                      className="text-xs text-[var(--t3)] hover:text-[var(--t1)]"
                    >
                      Скасувати
                    </button>
                    {error && <p className="w-full text-xs text-[var(--bad)]">{error}</p>}
                  </div>
                ) : (
                  <div className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[var(--t1)] truncate">{m.email}</p>
                      {m.telegram_chat_id && (
                        <p className="text-xs text-[var(--t3)] mt-0.5">Telegram ✓</p>
                      )}
                    </div>
                    <span className="text-xs text-[var(--t3)] hidden sm:block" style={{ fontFamily: 'var(--font-mono)' }}>
                      {new Date(m.created_at).toLocaleDateString('uk-UA', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
                    </span>
                    {isOwner && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => { setEditId(m.id); setNewPassword(''); setError(''); }}
                          className="text-xs px-2 py-1 rounded"
                          style={{ background: 'var(--s1)', border: '1px solid var(--br)', color: 'var(--t3)', borderRadius: '6px' }}
                        >
                          Пароль
                        </button>
                        <button
                          onClick={() => handleDelete(m.id, m.email)}
                          disabled={isPending}
                          className="p-1 rounded disabled:opacity-40"
                          style={{ color: 'var(--bad)' }}
                          title="Видалити"
                        >
                          <Trash2 size={14} strokeWidth={1.75} />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
