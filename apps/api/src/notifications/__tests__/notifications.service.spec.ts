import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotificationsService, PushPayload } from '../notifications.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

// ── Firebase Admin mock ────────────────────────────────────────────────────
const mockSend = jest.fn();
const mockMessaging = jest.fn(() => ({ send: mockSend }));
const mockInitializeApp = jest.fn(() => ({ messaging: mockMessaging }));

jest.mock('firebase-admin', () => ({
  credential: { cert: jest.fn() },
  initializeApp: (..._args: unknown[]) => mockInitializeApp(),
  app: {},
}));

// ── Native fetch mock ──────────────────────────────────────────────────────
const mockFetch = jest.fn();
global.fetch = mockFetch;

// ── Prisma mock ────────────────────────────────────────────────────────────
const mockCourier = {
  findUnique: jest.fn(),
  update: jest.fn().mockResolvedValue({}),
};
const mockPrisma = { courier: mockCourier };

// ── Config mock ────────────────────────────────────────────────────────────
const mockConfig = {
  get: jest.fn((key: string) => {
    if (key === 'FIREBASE_SERVICE_ACCOUNT_JSON')
      return JSON.stringify({ type: 'service_account', project_id: 'test' });
    if (key === 'TELEGRAM_BOT_TOKEN') return 'test-bot-token';
    return undefined;
  }),
  getOrThrow: jest.fn((key: string) => {
    throw new Error(`Missing config: ${key}`);
  }),
};

const pushPayload: PushPayload = { title: 'Order', body: 'New order for you' };

describe('NotificationsService', () => {
  let service: NotificationsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    // Simulate Firebase initialized
    (service as any).fcmApp = { messaging: mockMessaging };

    jest.clearAllMocks();
    mockSend.mockResolvedValue('message-id');
  });

  // ── sendPush ──────────────────────────────────────────────────────────────

  describe('sendPush', () => {
    it('sends push when courier has a valid device_token', async () => {
      mockCourier.findUnique.mockResolvedValue({
        device_token: 'valid-token-123',
      });

      await service.sendPush('c1', pushPayload);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const msg = mockSend.mock.calls[0][0];
      expect(msg.token).toBe('valid-token-123');
      expect(msg.notification.title).toBe('Order');
    });

    it('skips push when courier has no device_token', async () => {
      mockCourier.findUnique.mockResolvedValue({ device_token: null });

      await service.sendPush('c1', pushPayload);

      expect(mockSend).not.toHaveBeenCalled();
    });

    it('skips push when courier not found', async () => {
      mockCourier.findUnique.mockResolvedValue(null);

      await service.sendPush('c1', pushPayload);

      expect(mockSend).not.toHaveBeenCalled();
    });

    it('clears device_token on invalid_registration error', async () => {
      mockCourier.findUnique.mockResolvedValue({ device_token: 'stale-token' });
      mockSend.mockRejectedValue({
        errorInfo: { code: 'messaging/invalid-registration-token' },
      });

      await service.sendPush('c1', pushPayload);

      expect(mockCourier.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { device_token: null },
      });
    });

    it('clears device_token on registration-token-not-registered error', async () => {
      mockCourier.findUnique.mockResolvedValue({ device_token: 'old-token' });
      mockSend.mockRejectedValue({
        errorInfo: { code: 'messaging/registration-token-not-registered' },
      });

      await service.sendPush('c1', pushPayload);

      expect(mockCourier.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { device_token: null },
      });
    });

    it('does NOT clear device_token on transient FCM errors', async () => {
      mockCourier.findUnique.mockResolvedValue({ device_token: 'ok-token' });
      mockSend.mockRejectedValue({
        errorInfo: { code: 'messaging/internal-error' },
      });

      await service.sendPush('c1', pushPayload);

      expect(mockCourier.update).not.toHaveBeenCalled();
    });

    it('skips push when FCM not initialized', async () => {
      (service as any).fcmApp = null;
      mockCourier.findUnique.mockResolvedValue({ device_token: 'token' });

      await service.sendPush('c1', pushPayload);

      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  // ── sendTelegram ──────────────────────────────────────────────────────────

  describe('sendTelegram', () => {
    it('sends message to Telegram Bot API', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      await service.sendTelegram('123456789', 'Hello manager');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('/sendMessage');
      expect(url).toContain('test-bot-token');
      const body = JSON.parse(opts.body as string);
      expect(body.chat_id).toBe('123456789');
      expect(body.text).toBe('Hello manager');
    });

    it('does not throw on Telegram API error response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('{"ok":false,"description":"Bad Request"}'),
      });

      await expect(
        service.sendTelegram('bad-chat', 'msg'),
      ).resolves.not.toThrow();
    });

    it('does not throw on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network failure'));

      await expect(service.sendTelegram('123', 'msg')).resolves.not.toThrow();
    });
  });
});
