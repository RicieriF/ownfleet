import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { IntegrationType, OrderSource } from '@prisma/client';

const POLL_INTERVAL_CRON = '*/2 * * * *'; // every 2 minutes
const MAX_BACKOFF_MS = 5 * 60_000; // 5 min cap
const BASE_BACKOFF_MS = 5_000;     // 5 sec initial

interface BackoffState {
  until: number;
  attempts: number;
}

interface IikoOrder {
  id: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  comment?: string;
}

@Injectable()
export class IikoService {
  private readonly logger = new Logger(IikoService.name);

  // In-memory backoff state per establishment — reset on restart (acceptable for 2-min cron)
  private readonly backoff = new Map<string, BackoffState>();

  constructor(private readonly prisma: PrismaService) {}

  @Cron(POLL_INTERVAL_CRON, { name: 'iiko-poll', timeZone: 'UTC' })
  async pollAll(): Promise<void> {
    const integrations = await this.prisma.integration.findMany({
      where: { type: IntegrationType.iiko, active: true },
    });

    for (const integration of integrations) {
      await this.pollEstablishment(integration.establishment_id, integration.config);
    }
  }

  /**
   * Poll one establishment's iiko instance.
   * Public so it can be called from tests or admin tooling.
   */
  async pollEstablishment(establishmentId: string, config: unknown): Promise<void> {
    if (this.isBackingOff(establishmentId)) {
      const state = this.backoff.get(establishmentId)!;
      this.logger.debug(
        `[iiko:${establishmentId}] backing off — ${Math.ceil((state.until - Date.now()) / 1000)}s remaining`,
      );
      return;
    }

    const cfg = config as Record<string, unknown>;
    const serverUrl = cfg['server_url'] as string | undefined;
    const login = cfg['login'] as string | undefined;
    const password = cfg['password'] as string | undefined;
    const organizationId = cfg['organization_id'] as string | undefined;

    if (!serverUrl || !login || !password || !organizationId) {
      this.logger.warn(`[iiko:${establishmentId}] incomplete config — skipping`);
      return;
    }

    try {
      const token = await this.getSessionToken(serverUrl, login, password);
      const orders = await this.fetchDeliveryOrders(serverUrl, token, organizationId);

      this.clearBackoff(establishmentId);

      if (orders.length > 0) {
        const result = await this.prisma.order.createMany({
          data: orders.map((order) => ({
            establishment_id: establishmentId,
            external_id: order.id,
            address: order.address ?? 'Unknown',
            lat: order.latitude ?? null,
            lng: order.longitude ?? null,
            notes: order.comment ?? null,
            source: OrderSource.iiko,
          })),
          skipDuplicates: true,
        });

        if (result.count > 0) {
          this.logger.log(`[iiko:${establishmentId}] ingested ${result.count} new orders`);
        }
      }
    } catch (err: unknown) {
      await this.handlePollError(establishmentId, err);
    }
  }

  private async getSessionToken(
    serverUrl: string,
    login: string,
    password: string,
  ): Promise<string> {
    // Use URL object so credentials don't appear as a plain string in logs
    const url = new URL('/resto/api/auth', serverUrl);
    url.searchParams.set('login', login);
    url.searchParams.set('pass', password);
    const res = await fetch(url.toString());
    await this.assertNotRateLimited(res);
    if (!res.ok) throw new Error(`iiko auth failed: ${res.status}`);
    const text = await res.text();
    return text.trim();
  }

  private async fetchDeliveryOrders(
    serverUrl: string,
    token: string,
    organizationId: string,
  ): Promise<IikoOrder[]> {
    const url = `${serverUrl}/resto/api/v2/deliveries/search?organization=${organizationId}&statuses=Unconfirmed,WaitCooking`;
    const res = await fetch(url, { headers: { Cookie: `key=${token}` } });
    await this.assertNotRateLimited(res);
    if (!res.ok) throw new Error(`iiko fetch orders failed: ${res.status}`);
    const data = await res.json() as { deliveryOrders?: IikoOrder[] };
    return data.deliveryOrders ?? [];
  }

  // ── Rate-limiting / backoff helpers ──────────────────────────────────────

  private async assertNotRateLimited(res: Response): Promise<void> {
    if (res.status === 429) {
      throw new RateLimitError();
    }
  }

  private isBackingOff(establishmentId: string): boolean {
    const state = this.backoff.get(establishmentId);
    if (!state) return false;
    // Don't delete on expiry — preserve attempts count so delay keeps doubling
    // until a successful poll clears the state via clearBackoff()
    return Date.now() < state.until;
  }

  private recordBackoff(establishmentId: string): void {
    const current = this.backoff.get(establishmentId) ?? { until: 0, attempts: 0 };
    const attempts = current.attempts + 1;
    const delayMs = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, attempts - 1));
    this.backoff.set(establishmentId, { until: Date.now() + delayMs, attempts });
    this.logger.warn(
      `[iiko:${establishmentId}] rate limited — backoff ${delayMs}ms (attempt ${attempts})`,
    );
  }

  private clearBackoff(establishmentId: string): void {
    this.backoff.delete(establishmentId);
  }

  private async handlePollError(establishmentId: string, err: unknown): Promise<void> {
    if (err instanceof RateLimitError) {
      this.recordBackoff(establishmentId);
    } else {
      this.logger.error(`[iiko:${establishmentId}] poll failed`, err);
    }
    // Never rethrow — cron must not crash
  }

  /** Exposed for testing only */
  getBackoffState(establishmentId: string): BackoffState | undefined {
    return this.backoff.get(establishmentId);
  }
}

class RateLimitError extends Error {
  constructor() {
    super('429 Rate Limited');
  }
}
