import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { PrismaService } from '../prisma/prisma.service.js';

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly telegramApiBase: string | null;
  private fcmApp: admin.app.App | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const telegramToken = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    if (!telegramToken) {
      this.logger.warn('TELEGRAM_BOT_TOKEN not set — Telegram notifications disabled');
      this.telegramApiBase = null;
    } else {
      this.telegramApiBase = `https://api.telegram.org/bot${telegramToken}`;
    }
  }

  onModuleInit(): void {
    const serviceAccountJson = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_JSON');
    if (!serviceAccountJson) {
      this.logger.warn('FIREBASE_SERVICE_ACCOUNT_JSON not set — FCM push disabled');
      return;
    }
    try {
      const serviceAccount = JSON.parse(serviceAccountJson) as admin.ServiceAccount;
      this.fcmApp = admin.initializeApp(
        { credential: admin.credential.cert(serviceAccount) },
        'weego-cmi',
      );
    } catch (err) {
      this.logger.error('Failed to initialize Firebase Admin SDK', err);
    }
  }

  /**
   * Fire-and-forget FCM push.
   * Call without await at the callsite.
   * On invalid_registration automatically clears the device_token.
   */
  async sendPush(courierId: string, payload: PushPayload): Promise<void> {
    if (!this.fcmApp) {
      this.logger.warn(`FCM not initialized — skipping push for courier ${courierId}`);
      return;
    }

    const courier = await this.prisma.courier.findUnique({
      where: { id: courierId },
      select: { device_token: true },
    });

    if (!courier?.device_token) {
      this.logger.debug(`Courier ${courierId} has no device_token — skipping push`);
      return;
    }

    const message: admin.messaging.Message = {
      token: courier.device_token,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: payload.data ?? {},
      android: {
        priority: 'high',
      },
      apns: {
        payload: {
          aps: { sound: 'default' },
        },
      },
    };

    try {
      await this.fcmApp.messaging().send(message);
      this.logger.debug(`Push sent to courier ${courierId}`);
    } catch (err: unknown) {
      const fcmErr = err as { errorInfo?: { code?: string } };
      const code = fcmErr?.errorInfo?.code ?? '';

      if (
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/registration-token-not-registered'
      ) {
        this.logger.warn(`Invalid FCM token for courier ${courierId} — clearing`);
        await this.prisma.courier
          .update({ where: { id: courierId }, data: { device_token: null } })
          .catch((e) => this.logger.error(`Failed to clear device_token for ${courierId}`, e));
      } else {
        this.logger.warn(`FCM send failed for courier ${courierId}: ${code}`, err);
      }
    }
  }

  /**
   * Fire-and-forget Telegram message.
   * Call without await at the callsite.
   */
  async sendTelegram(chatId: string, text: string): Promise<void> {
    if (!this.telegramApiBase) {
      this.logger.debug(`Telegram disabled — skipping message to chat ${chatId}`);
      return;
    }
    const url = `${this.telegramApiBase}/sendMessage`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
      });

      if (!response.ok) {
        const body = await response.text();
        this.logger.warn(`Telegram sendMessage failed: ${response.status} ${body}`);
      }
    } catch (err) {
      this.logger.warn('Telegram sendMessage error', err);
    }
  }
}
