import { apiFetch } from '@/lib/api';
import { Webhook } from '@/types';
import { WebhooksManager } from './webhooks-manager';
import { t } from '@/lib/i18n';
import { getLocale } from '@/lib/i18n/server';

export default async function WebhooksPage() {
  const locale = await getLocale();
  const webhooks = await apiFetch<Webhook[]>('/api/v1/webhooks');

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--t1)' }}>Webhooks</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--t3)' }}>
          {t('Вихідні HTTP-повідомлення при зміні статусів замовлень та доставок.', locale)}{' '}
          {t('Підписи HMAC-SHA256 передаються в заголовку', locale)}{' '}
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
