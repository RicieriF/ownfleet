import { Test, TestingModule } from '@nestjs/testing';
import { WebhookDispatchProcessor } from '../webhook-dispatch.processor.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const mockFetch = jest.fn();
global.fetch = mockFetch;

const baseWebhook = {
  id: 'wh-1',
  establishment_id: 'est-1',
  url: 'https://example.com/hook',
  secret: 'test-secret',
  active: true,
  consecutive_failures: 0,
};

const mockWebhook = {
  findUnique: jest.fn(),
  update: jest.fn().mockResolvedValue({}),
};
const mockPrisma = { webhook: mockWebhook };

const makeJob = (data = {}) => ({
  data: {
    webhookId: 'wh-1',
    event: 'order.created',
    payload: { order_id: 'o1' },
    ...data,
  },
}) as any;

const makeResponse = (status: number) => ({
  ok: status >= 200 && status < 300,
  status,
});

describe('WebhookDispatchProcessor', () => {
  let processor: WebhookDispatchProcessor;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookDispatchProcessor,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    processor = module.get<WebhookDispatchProcessor>(WebhookDispatchProcessor);
    jest.clearAllMocks();
    mockWebhook.findUnique.mockResolvedValue(baseWebhook);
    mockWebhook.update.mockResolvedValue({});
    mockFetch.mockResolvedValue(makeResponse(200));
  });

  // ── Happy path ────────────────────────────────────────────────────────

  describe('successful delivery', () => {
    it('POSTs to the webhook URL with correct headers', async () => {
      await processor.handleDeliver(makeJob());

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://example.com/hook');
      expect(opts.method).toBe('POST');
      expect(opts.headers['Content-Type']).toBe('application/json');
      expect(opts.headers['X-Webhook-Event']).toBe('order.created');
    });

    it('includes HMAC-SHA256 signature header', async () => {
      await processor.handleDeliver(makeJob());

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers['X-Webhook-Signature']).toMatch(/^sha256=[a-f0-9]{64}$/);
    });

    it('resets consecutive_failures to 0 on success', async () => {
      await processor.handleDeliver(makeJob());

      expect(mockWebhook.update).toHaveBeenCalledWith({
        where: { id: 'wh-1' },
        data: { consecutive_failures: 0, last_error: null, last_error_at: null },
      });
    });
  });

  // ── Failure handling ──────────────────────────────────────────────────

  describe('HTTP failure', () => {
    it('increments consecutive_failures on non-2xx response', async () => {
      mockFetch.mockResolvedValue(makeResponse(500));

      await expect(processor.handleDeliver(makeJob())).rejects.toThrow('HTTP 500');

      expect(mockWebhook.update).toHaveBeenCalledWith({
        where: { id: 'wh-1' },
        data: expect.objectContaining({
          consecutive_failures: { increment: 1 },
          last_error: 'HTTP 500',
          last_error_at: expect.any(Date),
        }),
      });
    });

    it('throws on failure so Bull can retry', async () => {
      mockFetch.mockResolvedValue(makeResponse(503));
      await expect(processor.handleDeliver(makeJob())).rejects.toThrow();
    });
  });

  describe('network error', () => {
    it('records failure and rethrows on fetch exception', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      await expect(processor.handleDeliver(makeJob())).rejects.toThrow('Connection refused');

      expect(mockWebhook.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'wh-1' } }),
      );
    });
  });

  // ── Skip conditions ───────────────────────────────────────────────────

  describe('skip conditions', () => {
    it('skips delivery silently when webhook was deleted', async () => {
      mockWebhook.findUnique.mockResolvedValue(null);

      await expect(processor.handleDeliver(makeJob())).resolves.not.toThrow();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('skips delivery silently when webhook was disabled after queuing', async () => {
      mockWebhook.findUnique.mockResolvedValue({ ...baseWebhook, active: false });

      await expect(processor.handleDeliver(makeJob())).resolves.not.toThrow();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ── Payload integrity ─────────────────────────────────────────────────

  describe('payload', () => {
    it('includes event, payload, timestamp, and webhook_id in request body', async () => {
      await processor.handleDeliver(makeJob());

      const [, opts] = mockFetch.mock.calls[0];
      const body = JSON.parse(opts.body as string);
      expect(body.event).toBe('order.created');
      expect(body.payload).toEqual({ order_id: 'o1' });
      expect(body.timestamp).toBeDefined();
      expect(body.webhook_id).toBe('wh-1');
    });
  });
});
