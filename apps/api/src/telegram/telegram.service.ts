import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service.js';
import { TELEGRAM_REDIS, CONNECT_CODE_TTL_SEC as TTL_SEC } from './telegram-redis.provider.js';
import {
  TelegramUpdate,
  ManagerTelegramPrefs,
  CourierTelegramPrefs,
  ManagerTelegramEvent,
  CourierTelegramEvent,
  DEFAULT_MANAGER_PREFS,
  DEFAULT_COURIER_PREFS,
} from './telegram.types.js';

const CONNECT_KEY_PREFIX = 'telegram:connect:';
const PENDING_RECONNECT_KEY_PREFIX = 'telegram:pending_reconnect:';
const PENDING_RECONNECT_TTL_SEC = 300; // 5 minutes

interface ConnectPayload {
  user_id: string;
  courier_id: string | null;
}

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly apiBase: string | null;
  private readonly webhookSecret: string | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(TELEGRAM_REDIS) private readonly redis: Redis,
  ) {
    const token = config.get<string>('TELEGRAM_BOT_TOKEN');
    this.apiBase = token ? `https://api.telegram.org/bot${token}` : null;
    this.webhookSecret = config.get<string>('TELEGRAM_WEBHOOK_SECRET') ?? null;

    if (!token) {
      this.logger.warn('TELEGRAM_BOT_TOKEN not set — Telegram bot disabled');
    } else if (!this.webhookSecret) {
      this.logger.warn(
        'TELEGRAM_WEBHOOK_SECRET not set — webhook endpoint is open to unauthenticated requests. Set this in production.',
      );
    }
  }

  // ── Connect flow ──────────────────────────────────────────────────────────

  /**
   * Generate a one-time connect code for the given user.
   * courierId is set when the connecting user is a courier.
   */
  async generateConnectCode(userId: string, courierId: string | null): Promise<string> {
    const code = this.makeCode();
    const payload: ConnectPayload = { user_id: userId, courier_id: courierId };
    await this.redis.setex(
      `${CONNECT_KEY_PREFIX}${code}`,
      TTL_SEC,
      JSON.stringify(payload),
    );
    return code;
  }

  /**
   * Process an incoming Telegram update (from webhook).
   * Returns false if the secret token is invalid.
   */
  async handleWebhookUpdate(update: TelegramUpdate, secretHeader: string | undefined): Promise<boolean> {
    if (this.webhookSecret && secretHeader !== this.webhookSecret) {
      this.logger.warn('Telegram webhook: invalid secret token');
      return false;
    }

    const msg = update.message;
    if (!msg?.text) return true;

    const chatId = String(msg.chat.id);
    const text = msg.text.trim();

    if (text.startsWith('/start')) {
      await this.handleStart(chatId, text);
    } else if (text === '/stop') {
      await this.handleStop(chatId);
    } else if (text === '/status') {
      await this.handleStatus(chatId);
    } else if (text === '/підтвердити') {
      await this.handleConfirmReconnect(chatId);
    } else if (text === '/скасувати') {
      await this.handleCancelReconnect(chatId);
    }

    return true;
  }

  // ── Status / disconnect ───────────────────────────────────────────────────

  async getStatus(userId: string, courierId: string | null, establishmentId: string): Promise<{
    connected: boolean;
    prefs: ManagerTelegramPrefs | CourierTelegramPrefs;
  }> {
    if (courierId) {
      const courier = await this.prisma.courier.findUnique({
        where: { id: courierId, establishment_id: establishmentId },
        select: { telegram_chat_id: true, telegram_prefs: true },
      });
      return {
        connected: !!courier?.telegram_chat_id,
        prefs: (courier?.telegram_prefs as CourierTelegramPrefs) ?? {},
      };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { telegram_chat_id: true, telegram_prefs: true },
    });
    return {
      connected: !!user?.telegram_chat_id,
      prefs: (user?.telegram_prefs as ManagerTelegramPrefs) ?? {},
    };
  }

  async updatePrefs(
    userId: string,
    courierId: string | null,
    establishmentId: string,
    patch: ManagerTelegramPrefs | CourierTelegramPrefs,
  ): Promise<void> {
    if (courierId) {
      const existing = await this.prisma.courier.findUnique({
        where: { id: courierId, establishment_id: establishmentId },
        select: { telegram_prefs: true },
      });
      const merged = { ...((existing?.telegram_prefs as object) ?? {}), ...patch } as Prisma.InputJsonValue;
      await this.prisma.courier.update({
        where: { id: courierId, establishment_id: establishmentId },
        data: { telegram_prefs: merged },
      });
    } else {
      const existing = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { telegram_prefs: true },
      });
      const merged = { ...((existing?.telegram_prefs as object) ?? {}), ...patch } as Prisma.InputJsonValue;
      await this.prisma.user.update({
        where: { id: userId },
        data: { telegram_prefs: merged },
      });
    }
  }

  async disconnect(userId: string, courierId: string | null, establishmentId: string): Promise<void> {
    if (courierId) {
      await this.prisma.courier.update({
        where: { id: courierId, establishment_id: establishmentId },
        data: { telegram_chat_id: null, telegram_prefs: {} },
      });
    } else {
      await this.prisma.user.update({
        where: { id: userId },
        data: { telegram_chat_id: null, telegram_prefs: {} },
      });
    }
    this.logger.log(`Telegram disconnected for user ${userId}`);
  }

  // ── Notification helpers (used by other services in step 6) ───────────────

  /**
   * Send a Telegram message to all managers/owners of an establishment
   * who have the given event enabled in their prefs.
   * Fire-and-forget: call without await.
   */
  async notifyEstablishmentManagers(
    establishmentId: string,
    text: string,
    event: ManagerTelegramEvent,
  ): Promise<void> {
    if (!this.apiBase) return;

    const users = await this.prisma.user.findMany({
      where: {
        establishment_id: establishmentId,
        role: { in: ['owner', 'manager'] },
        telegram_chat_id: { not: null },
      },
      select: { telegram_chat_id: true, telegram_prefs: true },
    });

    for (const user of users) {
      const prefs = (user.telegram_prefs as ManagerTelegramPrefs) ?? {};
      if (!prefs[event]) continue;
      if (user.telegram_chat_id) {
        this.sendMessage(user.telegram_chat_id, text).catch((err) =>
          this.logger.warn(`Telegram send failed for manager in ${establishmentId}`, err),
        );
      }
    }
  }

  /**
   * Send a Telegram message to a courier if they have the event enabled.
   * Fire-and-forget: call without await.
   */
  async notifyCourier(
    courierId: string,
    text: string,
    event: CourierTelegramEvent,
  ): Promise<void> {
    if (!this.apiBase) return;

    const courier = await this.prisma.courier.findUnique({
      where: { id: courierId },
      select: { telegram_chat_id: true, telegram_prefs: true },
    });

    if (!courier?.telegram_chat_id) return;
    const prefs = (courier.telegram_prefs as CourierTelegramPrefs) ?? {};
    if (!prefs[event]) return;

    this.sendMessage(courier.telegram_chat_id, text).catch((err) =>
      this.logger.warn(`Telegram send failed for courier ${courierId}`, err),
    );
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async handleStart(chatId: string, text: string): Promise<void> {
    const parts = text.split(' ');
    const code = parts[1]?.trim();

    if (!code) {
      await this.sendMessage(chatId, 'Щоб підключити акаунт, введіть код з дашборду або додатку:\n/start ВАШ-КОД');
      return;
    }

    // Atomic get-and-delete (Redis 6.2+) — prevents TOCTOU race where two
    // concurrent /start requests both read the code before either deletes it.
    const raw = await (this.redis as any).getdel(`${CONNECT_KEY_PREFIX}${code}`);
    if (!raw) {
      await this.sendMessage(chatId, '❌ Код не знайдено або він вже вичерпав термін дії. Згенеруйте новий в налаштуваннях.');
      return;
    }

    const payload = JSON.parse(raw) as ConnectPayload;

    // DB write happens after code is atomically consumed.
    try {
      if (payload.courier_id) {
        const existing = await this.prisma.courier.findUnique({
          where: { id: payload.courier_id },
          select: { telegram_prefs: true },
        });
        const prefs = (existing?.telegram_prefs as CourierTelegramPrefs | null) ?? null;
        const courierPrefs = (prefs && Object.keys(prefs).length > 0 ? prefs : DEFAULT_COURIER_PREFS) as Prisma.InputJsonValue;
        await this.prisma.courier.update({
          where: { id: payload.courier_id },
          data: {
            telegram_chat_id: chatId,
            telegram_prefs: courierPrefs,
          },
        });
      } else {
        const existing = await this.prisma.user.findUnique({
          where: { id: payload.user_id },
          select: { telegram_prefs: true },
        });
        const prefs = (existing?.telegram_prefs as ManagerTelegramPrefs | null) ?? null;
        const userPrefs = (prefs && Object.keys(prefs).length > 0 ? prefs : DEFAULT_MANAGER_PREFS) as Prisma.InputJsonValue;
        await this.prisma.user.update({
          where: { id: payload.user_id },
          data: {
            telegram_chat_id: chatId,
            telegram_prefs: userPrefs,
          },
        });
      }
    } catch (err: any) {
      // P2002 = unique constraint violation — this chatId is already linked to a different account.
      // Ask the user if they want to disconnect the old account and connect this one.
      if (err?.code === 'P2002') {
        await this.redis.setex(
          `${PENDING_RECONNECT_KEY_PREFIX}${chatId}`,
          PENDING_RECONNECT_TTL_SEC,
          JSON.stringify(payload),
        );
        await this.sendMessage(
          chatId,
          '⚠️ Цей Telegram вже підключений до іншого акаунту.\n\nВідʼєднати старий акаунт і підключити цей?\n\n/підтвердити — так, підключити цей\n/скасувати — ні, залишити як є',
        );
        return;
      }
      throw err;
    }

    await this.sendMessage(chatId, '✅ Акаунт підключено! Тепер ви будете отримувати сповіщення.\n\nНалаштуйте які сповіщення отримувати в дашборді або додатку.\n\nДля відключення — /stop');
    this.logger.log(`Telegram connected for user ${payload.user_id}`);
  }

  private async handleStop(chatId: string): Promise<void> {
    // Find and clear by chat_id
    const [userResult, courierResult] = await Promise.all([
      this.prisma.user.updateMany({
        where: { telegram_chat_id: chatId },
        data: { telegram_chat_id: null, telegram_prefs: {} },
      }),
      this.prisma.courier.updateMany({
        where: { telegram_chat_id: chatId },
        data: { telegram_chat_id: null, telegram_prefs: {} },
      }),
    ]);

    if (userResult.count > 0 || courierResult.count > 0) {
      await this.sendMessage(chatId, '✅ Відключено. Ви більше не будете отримувати сповіщення.\n\nДля повторного підключення — згенеруйте новий код в налаштуваннях.');
      this.logger.log(`Telegram disconnected via /stop for chat ${chatId}`);
    } else {
      await this.sendMessage(chatId, 'Акаунт не був підключений.');
    }
  }

  private async handleConfirmReconnect(chatId: string): Promise<void> {
    const raw = await (this.redis as any).getdel(`${PENDING_RECONNECT_KEY_PREFIX}${chatId}`);
    if (!raw) {
      await this.sendMessage(chatId, 'Запит на перепідключення не знайдено або вичерпав термін дії. Спробуйте знову з новим кодом.');
      return;
    }

    const payload = JSON.parse(raw) as ConnectPayload;

    try {
      if (payload.courier_id) {
        const existing = await this.prisma.courier.findUnique({
          where: { id: payload.courier_id },
          select: { telegram_prefs: true },
        });
        const prefs = (existing?.telegram_prefs as CourierTelegramPrefs | null) ?? null;
        const courierPrefs = (prefs && Object.keys(prefs).length > 0 ? prefs : DEFAULT_COURIER_PREFS) as Prisma.InputJsonValue;
        await this.prisma.$transaction([
          this.prisma.courier.updateMany({
            where: { telegram_chat_id: chatId },
            data: { telegram_chat_id: null, telegram_prefs: {} },
          }),
          this.prisma.courier.update({
            where: { id: payload.courier_id },
            data: { telegram_chat_id: chatId, telegram_prefs: courierPrefs },
          }),
        ]);
      } else {
        const existing = await this.prisma.user.findUnique({
          where: { id: payload.user_id },
          select: { telegram_prefs: true },
        });
        const prefs = (existing?.telegram_prefs as ManagerTelegramPrefs | null) ?? null;
        const userPrefs = (prefs && Object.keys(prefs).length > 0 ? prefs : DEFAULT_MANAGER_PREFS) as Prisma.InputJsonValue;
        await this.prisma.$transaction([
          this.prisma.user.updateMany({
            where: { telegram_chat_id: chatId },
            data: { telegram_chat_id: null, telegram_prefs: {} },
          }),
          this.prisma.user.update({
            where: { id: payload.user_id },
            data: { telegram_chat_id: chatId, telegram_prefs: userPrefs },
          }),
        ]);
      }
    } catch (err) {
      this.logger.error(`Telegram reconnect failed for user ${payload.user_id}`, err);
      await this.sendMessage(chatId, '❌ Сталася помилка при перепідключенні. Спробуйте ще раз.');
      return;
    }

    await this.sendMessage(chatId, '✅ Підключено! Старий акаунт відʼєднано.\n\nДля відключення — /stop');
    this.logger.log(`Telegram reconnected for user ${payload.user_id} (chat ${chatId})`);
  }

  private async handleCancelReconnect(chatId: string): Promise<void> {
    const deleted = await this.redis.del(`${PENDING_RECONNECT_KEY_PREFIX}${chatId}`);
    if (deleted > 0) {
      await this.sendMessage(chatId, 'Скасовано. Поточне підключення залишено без змін.');
    } else {
      await this.sendMessage(chatId, 'Немає активного запиту на перепідключення.');
    }
  }

  private async handleStatus(chatId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { telegram_chat_id: chatId },
      select: { telegram_prefs: true },
    });
    const courier = !user
      ? await this.prisma.courier.findFirst({
          where: { telegram_chat_id: chatId },
          select: { telegram_prefs: true },
        })
      : null;

    if (!user && !courier) {
      await this.sendMessage(chatId, 'Акаунт не підключено.');
      return;
    }

    const prefs = (user?.telegram_prefs ?? courier?.telegram_prefs) as Record<string, boolean> ?? {};
    const enabled = Object.entries(prefs)
      .filter(([, v]) => v)
      .map(([k]) => `• ${k}`)
      .join('\n');

    await this.sendMessage(
      chatId,
      `✅ Підключено\n\nУвімкнені сповіщення:\n${enabled || '— жодних'}`,
    );
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    if (!this.apiBase) return;
    try {
      const res = await fetch(`${this.apiBase}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      if (!res.ok) {
        const body = await res.text();
        this.logger.warn(`Telegram sendMessage failed: ${res.status} ${body}`);
      }
    } catch (err) {
      this.logger.warn('Telegram sendMessage error', err);
    }
  }

  /**
   * Atomic SET NX EX — sets key with TTL only if it doesn't exist yet.
   * Returns true if the key was newly created (first call), false if it already existed.
   * Used by other services for deduplication (e.g. shift-ending-soon notifications).
   */
  async setNxWithTtl(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.redis.set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  private makeCode(): string {
    // 4 bytes = 32 bits = 4.3B combinations → e.g. "A3F1-9C2D"
    const hex = randomBytes(4).toString('hex').toUpperCase();
    return `${hex.slice(0, 4)}-${hex.slice(4)}`;
  }
}
