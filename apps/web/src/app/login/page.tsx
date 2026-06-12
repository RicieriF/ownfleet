'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Невірний email або пароль');
        return;
      }

      router.push('/');
      router.refresh();
    } catch {
      setError('Помилка мережі. Спробуйте ще раз.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
      <div className="w-full max-w-sm bg-[var(--sf)] rounded-lg border border-[var(--br)] p-8 card-shine">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[var(--t1)]">OwnFleet</h1>
          <p className="text-sm text-[var(--t3)] mt-1">Увійдіть до свого облікового запису</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-[var(--t2)] mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--br)] rounded-md text-sm text-[var(--t1)] placeholder:text-[var(--t3)] focus:outline-none focus:ring-1 focus:ring-[rgba(250,249,246,0.25)] focus:border-[rgba(250,249,246,0.25)] transition-colors"
              placeholder="manager@restaurant.ua"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-[var(--t2)] mb-1">
              Пароль
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--br)] rounded-md text-sm text-[var(--t1)] placeholder:text-[var(--t3)] focus:outline-none focus:ring-1 focus:ring-[rgba(250,249,246,0.25)] focus:border-[rgba(250,249,246,0.25)] transition-colors"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-sm text-[var(--bad)] bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.25)] px-3 py-2 rounded-md">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 bg-[var(--acm)] hover:bg-[var(--acm-h)] disabled:opacity-50 text-[var(--t1)] text-sm font-semibold rounded-[6px] transition-colors"
          >
            {loading ? 'Вхід...' : 'Увійти'}
          </button>
        </form>
      </div>
    </div>
  );
}
