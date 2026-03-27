import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TelegramService } from '../telegram.service.js';
import { TELEGRAM_REDIS } from '../telegram-redis.provider.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { DEFAULT_MANAGER_PREFS, DEFAULT_COURIER_PREFS } from '../telegram.types.js';

const managerUser = { id: 'u1', courier_id: null };
const courierUser = { id: 'u2', courier_id: 'c1' };

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  courier: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
  $transaction: jest.fn().mockImplementation((ops) => Promise.all(ops)),
};

const mockRedis = {
  setex: jest.fn().mockResolvedValue('OK'),
  get: jest.fn(),
  getdel: jest.fn(),
  del: jest.fn().mockResolvedValue(1),
};

const mockConfig = {
  get: jest.fn((key: string) => {
    if (key === 'TELEGRAM_BOT_TOKEN') return 'test-token';
    if (key === 'TELEGRAM_WEBHOOK_SECRET') return 'secret-xyz';
    return null;
  }),
  getOrThrow: jest.fn().mockReturnValue('redis://localhost'),
};

describe('TelegramService', () => {
  let service: TelegramService;

  beforeEach(async () => {
    // Restore the default mockConfig.get implementation before each test,
    // since some tests mutate it (e.g., the "no secret configured" test).
    mockConfig.get.mockImplementation((key: string) => {
      if (key === 'TELEGRAM_BOT_TOKEN') return 'test-token';
      if (key === 'TELEGRAM_WEBHOOK_SECRET') return 'secret-xyz';
      return null;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelegramService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TELEGRAM_REDIS, useValue: mockRedis },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get<TelegramService>(TelegramService);
    jest.clearAllMocks();
    mockRedis.setex.mockResolvedValue('OK');
    mockRedis.getdel.mockResolvedValue(null);
    mockRedis.del.mockResolvedValue(1);
    mockPrisma.user.update.mockResolvedValue({});
    mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.courier.update.mockResolvedValue({});
    mockPrisma.courier.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
  });

  describe('generateConnectCode', () => {
    it('stores code in Redis with 600s TTL for manager', async () => {
      const code = await service.generateConnectCode(managerUser.id, null);

      expect(code).toMatch(/^[A-F0-9]{4}-[A-F0-9]{4}$/);
      expect(mockRedis.setex).toHaveBeenCalledWith(
        `telegram:connect:${code}`,
        600,
        JSON.stringify({ user_id: managerUser.id, courier_id: null }),
      );
    });

    it('stores courier_id in payload for courier user', async () => {
      const code = await service.generateConnectCode(courierUser.id, courierUser.courier_id);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        `telegram:connect:${code}`,
        600,
        JSON.stringify({ user_id: courierUser.id, courier_id: 'c1' }),
      );
    });

    it('generates unique codes on each call', async () => {
      const code1 = await service.generateConnectCode('u1', null);
      const code2 = await service.generateConnectCode('u1', null);
      // Extremely unlikely to collide but validates format
      expect(code1).toMatch(/^[A-F0-9]{4}-[A-F0-9]{4}$/);
      expect(code2).toMatch(/^[A-F0-9]{4}-[A-F0-9]{4}$/);
    });
  });

  describe('handleWebhookUpdate — secret validation', () => {
    it('rejects update with wrong secret token', async () => {
      const result = await service.handleWebhookUpdate(
        { update_id: 1, message: { message_id: 1, chat: { id: 123 }, text: '/start ABC' } },
        'wrong-secret',
      );
      expect(result).toBe(false);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('accepts update with correct secret token', async () => {
      mockRedis.getdel.mockResolvedValue(null); // code not found
      const result = await service.handleWebhookUpdate(
        { update_id: 1, message: { message_id: 1, chat: { id: 123 }, text: '/start ABC' } },
        'secret-xyz',
      );
      expect(result).toBe(true);
    });

    it('rejects update when no webhook secret is configured', async () => {
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'TELEGRAM_BOT_TOKEN') return 'test-token';
        return null; // no TELEGRAM_WEBHOOK_SECRET
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          TelegramService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: TELEGRAM_REDIS, useValue: mockRedis },
          { provide: ConfigService, useValue: mockConfig },
        ],
      }).compile();
      const svc = module.get<TelegramService>(TelegramService);

      const result = await svc.handleWebhookUpdate(
        { update_id: 1, message: { message_id: 1, chat: { id: 123 }, text: '/start ABC' } },
        undefined,
      );
      expect(result).toBe(false);
    });
  });

  describe('handleWebhookUpdate — /start with valid code', () => {
    it('connects manager account and sets default prefs', async () => {
      mockRedis.getdel.mockResolvedValue(JSON.stringify({ user_id: 'u1', courier_id: null }));
      mockPrisma.user.findUnique.mockResolvedValue({ telegram_prefs: {} }); // no existing prefs

      // spy on sendMessage to avoid real HTTP
      jest.spyOn(service, 'sendMessage').mockResolvedValue();

      await service.handleWebhookUpdate(
        { update_id: 1, message: { message_id: 1, chat: { id: 42 }, text: '/start AAAA-BB' } },
        'secret-xyz',
      );

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { telegram_chat_id: '42', telegram_prefs: DEFAULT_MANAGER_PREFS },
      });
    });

    it('connects courier account and sets default courier prefs', async () => {
      mockRedis.getdel.mockResolvedValue(JSON.stringify({ user_id: 'u2', courier_id: 'c1' }));
      mockPrisma.courier.findUnique.mockResolvedValue({ telegram_prefs: {} });
      jest.spyOn(service, 'sendMessage').mockResolvedValue();

      await service.handleWebhookUpdate(
        { update_id: 1, message: { message_id: 1, chat: { id: 99 }, text: '/start AAAA-BB' } },
        'secret-xyz',
      );

      expect(mockPrisma.courier.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { telegram_chat_id: '99', telegram_prefs: DEFAULT_COURIER_PREFS },
      });
    });

    it('rejects expired/invalid code', async () => {
      mockRedis.getdel.mockResolvedValue(null);
      jest.spyOn(service, 'sendMessage').mockResolvedValue();

      await service.handleWebhookUpdate(
        { update_id: 1, message: { message_id: 1, chat: { id: 42 }, text: '/start BAD-CD' } },
        'secret-xyz',
      );

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.courier.update).not.toHaveBeenCalled();
    });
  });

  describe('handleWebhookUpdate — /stop', () => {
    it('clears chat_id from users and couriers by chat_id', async () => {
      jest.spyOn(service, 'sendMessage').mockResolvedValue();

      await service.handleWebhookUpdate(
        { update_id: 1, message: { message_id: 1, chat: { id: 42 }, text: '/stop' } },
        'secret-xyz',
      );

      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
        where: { telegram_chat_id: '42' },
        data: { telegram_chat_id: null, telegram_prefs: {} },
      });
      expect(mockPrisma.courier.updateMany).toHaveBeenCalledWith({
        where: { telegram_chat_id: '42' },
        data: { telegram_chat_id: null, telegram_prefs: {} },
      });
    });
  });

  describe('getStatus', () => {
    it('returns connected=true for manager with chat_id', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        telegram_chat_id: '42',
        telegram_prefs: { order_created: true },
      });
      const result = await service.getStatus('u1', null, 'est-1');
      expect(result.connected).toBe(true);
      expect(result.prefs).toMatchObject({ order_created: true });
    });

    it('returns connected=false for manager without chat_id', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ telegram_chat_id: null, telegram_prefs: {} });
      const result = await service.getStatus('u1', null, 'est-1');
      expect(result.connected).toBe(false);
    });

    it('returns courier status when courier_id provided', async () => {
      mockPrisma.courier.findUnique.mockResolvedValue({
        telegram_chat_id: '99',
        telegram_prefs: { delivery_assigned: true },
      });
      const result = await service.getStatus('u2', 'c1', 'est-1');
      expect(result.connected).toBe(true);
    });
  });

  describe('disconnect', () => {
    it('clears user telegram fields for manager', async () => {
      await service.disconnect('u1', null, 'est-1');
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { telegram_chat_id: null, telegram_prefs: {} },
      });
    });

    it('clears courier telegram fields for courier', async () => {
      await service.disconnect('u2', 'c1', 'est-1');
      expect(mockPrisma.courier.update).toHaveBeenCalledWith({
        where: { id: 'c1', establishment_id: 'est-1' },
        data: { telegram_chat_id: null, telegram_prefs: {} },
      });
    });
  });

  describe('notifyEstablishmentManagers', () => {
    it('sends only to managers who have the event enabled', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        { telegram_chat_id: '11', telegram_prefs: { order_created: true } },
        { telegram_chat_id: '22', telegram_prefs: { order_created: false } },
        { telegram_chat_id: '33', telegram_prefs: {} },
      ]);
      jest.spyOn(service, 'sendMessage').mockResolvedValue();

      await service.notifyEstablishmentManagers('est-1', 'Нове замовлення', 'order_created');

      expect(service.sendMessage).toHaveBeenCalledTimes(1);
      expect(service.sendMessage).toHaveBeenCalledWith('11', 'Нове замовлення');
    });
  });

  describe('handleWebhookUpdate — reconnect flow', () => {
    const RECONNECT_PREFIX = 'telegram:pending_reconnect:';

    it('stores pending reconnect and asks confirmation when P2002 on /start', async () => {
      mockRedis.getdel.mockResolvedValueOnce(JSON.stringify({ user_id: 'u1', courier_id: null }));
      mockPrisma.user.findUnique.mockResolvedValue({ telegram_prefs: {} });
      const p2002 = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      mockPrisma.user.update.mockRejectedValueOnce(p2002);
      mockRedis.setex.mockResolvedValue('OK');
      jest.spyOn(service, 'sendMessage').mockResolvedValue();

      await service.handleWebhookUpdate(
        { update_id: 1, message: { message_id: 1, chat: { id: 42 }, text: '/start AAAA-BBBB' } },
        'secret-xyz',
      );

      expect(mockRedis.setex).toHaveBeenCalledWith(
        `${RECONNECT_PREFIX}42`,
        300,
        JSON.stringify({ user_id: 'u1', courier_id: null }),
      );
      expect(service.sendMessage).toHaveBeenCalledWith('42', expect.stringContaining('/підтвердити'));
    });

    it('/підтвердити reconnects manager: clears old chatId + sets new in transaction', async () => {
      mockRedis.getdel.mockResolvedValueOnce(JSON.stringify({ user_id: 'u1', courier_id: null }));
      mockPrisma.user.findUnique.mockResolvedValue({ telegram_prefs: {} });
      jest.spyOn(service, 'sendMessage').mockResolvedValue();

      await service.handleWebhookUpdate(
        { update_id: 1, message: { message_id: 1, chat: { id: 42 }, text: '/підтвердити' } },
        'secret-xyz',
      );

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(service.sendMessage).toHaveBeenCalledWith('42', expect.stringContaining('✅'));
    });

    it('/підтвердити reconnects courier: uses courier updateMany + update in transaction', async () => {
      mockRedis.getdel.mockResolvedValueOnce(JSON.stringify({ user_id: 'u2', courier_id: 'c1' }));
      mockPrisma.courier.findUnique.mockResolvedValue({ telegram_prefs: {} });
      jest.spyOn(service, 'sendMessage').mockResolvedValue();

      await service.handleWebhookUpdate(
        { update_id: 1, message: { message_id: 1, chat: { id: 99 }, text: '/підтвердити' } },
        'secret-xyz',
      );

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(service.sendMessage).toHaveBeenCalledWith('99', expect.stringContaining('✅'));
    });

    it('/підтвердити with expired pending reconnect sends error message', async () => {
      mockRedis.getdel.mockResolvedValueOnce(null); // expired
      jest.spyOn(service, 'sendMessage').mockResolvedValue();

      await service.handleWebhookUpdate(
        { update_id: 1, message: { message_id: 1, chat: { id: 42 }, text: '/підтвердити' } },
        'secret-xyz',
      );

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(service.sendMessage).toHaveBeenCalledWith('42', expect.stringContaining('не знайдено'));
    });

    it('/скасувати deletes pending key and sends cancellation message', async () => {
      mockRedis.del.mockResolvedValueOnce(1);
      jest.spyOn(service, 'sendMessage').mockResolvedValue();

      await service.handleWebhookUpdate(
        { update_id: 1, message: { message_id: 1, chat: { id: 42 }, text: '/скасувати' } },
        'secret-xyz',
      );

      expect(mockRedis.del).toHaveBeenCalledWith(`${RECONNECT_PREFIX}42`);
      expect(service.sendMessage).toHaveBeenCalledWith('42', expect.stringContaining('Скасовано'));
    });

    it('/скасувати with no pending reconnect sends no-op message', async () => {
      mockRedis.del.mockResolvedValueOnce(0);
      jest.spyOn(service, 'sendMessage').mockResolvedValue();

      await service.handleWebhookUpdate(
        { update_id: 1, message: { message_id: 1, chat: { id: 42 }, text: '/скасувати' } },
        'secret-xyz',
      );

      expect(service.sendMessage).toHaveBeenCalledWith('42', expect.stringContaining('Немає активного'));
    });
  });

  describe('notifyCourier', () => {
    it('sends to courier with event enabled', async () => {
      mockPrisma.courier.findUnique.mockResolvedValue({
        telegram_chat_id: '99',
        telegram_prefs: { delivery_assigned: true },
      });
      jest.spyOn(service, 'sendMessage').mockResolvedValue();

      await service.notifyCourier('c1', 'Нова доставка', 'delivery_assigned');

      expect(service.sendMessage).toHaveBeenCalledWith('99', 'Нова доставка');
    });

    it('skips courier without chat_id', async () => {
      mockPrisma.courier.findUnique.mockResolvedValue({
        telegram_chat_id: null,
        telegram_prefs: { delivery_assigned: true },
      });
      jest.spyOn(service, 'sendMessage').mockResolvedValue();

      await service.notifyCourier('c1', 'Нова доставка', 'delivery_assigned');

      expect(service.sendMessage).not.toHaveBeenCalled();
    });

    it('skips courier with event disabled', async () => {
      mockPrisma.courier.findUnique.mockResolvedValue({
        telegram_chat_id: '99',
        telegram_prefs: { delivery_assigned: false },
      });
      jest.spyOn(service, 'sendMessage').mockResolvedValue();

      await service.notifyCourier('c1', 'Нова доставка', 'delivery_assigned');

      expect(service.sendMessage).not.toHaveBeenCalled();
    });
  });
});
