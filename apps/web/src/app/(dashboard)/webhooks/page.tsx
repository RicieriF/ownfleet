import { apiFetch } from '@/lib/api';
import { Webhook } from '@/types';
import { WebhooksManager } from './webhooks-manager';

export default async function WebhooksPage() {
  const webhooks = await apiFetch<Webhook[]>('/api/v1/webhooks');

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--t1)' }}>Webhooks</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--t4)' }}>
          Вихідні HTTP-повідомлення при зміні статусів замовлень та доставок.
          Підписи HMAC-SHA256 передаються в заголовку{' '}
          <code
            className="px-1 py-0.5 rounded text-xs"
            style={{ fontFamily: 'var(--font-mono)', background: 'var(--s2)', border: '1px solid var(--br)', color: 'var(--t3)' }}
          >
            X-Webhook-Signature
          </code>.
        </p>
      </div>

      <WebhooksManager initialWebhooks={webhooks} />
    </div>
  );
}
