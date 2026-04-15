import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { GeocodingService } from '../geocoding/geocoding.service.js';
import { TelegramService } from '../telegram/telegram.service.js';
import { MANAGER_EVENT } from '../telegram/telegram.types.js';
import { DistributedLockService } from '../shared/redis/distributed-lock.service.js';
import { IntegrationType, OrderSource } from '@prisma/client';
import { parseIikoConfig } from './integration-configs.js';

const POLL_INTERVAL_CRON = '*/2 * * * *'; // every 2 minutes
const MAX_BACKOFF_MS = 5 * 60_000; // 5 min cap
const BASE_BACKOFF_MS = 5_000; // 5 sec initial

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly geocodingService: GeocodingService,
    private readonly telegram: TelegramService,
    private readonly lock: DistributedLockService,
  ) {}

  @Cron(POLL_INTERVAL_CRON, { name: 'iiko-poll', timeZone: 'UTC' })
  async pollAll(): Promise<void> {
    // Global lock ensures only one instance polls at a time in multi-instance deployments.
    // TTL 90s is the crash-recovery window; the lock heartbeat inside withLock keeps it alive
    // for the full duration of pollAll regardless of how long iiko responses take.
    // In-memory backoff state is preserved on the instance that holds the lock.
    await this.lock.withLock('iiko-poll', 90, async () => {
      const integrations = await this.prisma.integration.findMany({
        where: { type: IntegrationType.iiko, active: true },
      });

      for (const integration of integrations) {
        await this.pollEstablishment(
          integration.establishment_id,
          integration.config,
        );
      }
    });
  }

  /**
   * Poll one establishment's iiko instance.
   * Public so it can be called from tests or admin tooling.
   */
  async pollEstablishment(
    establishmentId: string,
    config: unknown,
  ): Promise<void> {
    if (this.isBackingOff(establishmentId)) {
      const state = this.backoff.get(establishmentId)!;
      this.logger.debug(
        `[iiko:${establishmentId}] backing off — ${Math.ceil((state.until - Date.now()) / 1000)}s remaining`,
      );
      return;
    }

    const cfg = parseIikoConfig(config);
    if (!cfg) {
      this.logger.warn(
        `[iiko:${establishmentId}] incomplete config — skipping`,
      );
      return;
    }
    const {
      server_url: serverUrl,
      login,
      password,
      organization_id: organizationId,
    } = cfg;

    try {
      const token = await this.getSessionToken(serverUrl, login, password);
      const orders = await this.fetchDeliveryOrders(
        serverUrl,
        token,
        organizationId,
      );

      this.clearBackoff(establishmentId);

      if (orders.length > 0) {
        // iiko-provided coordinates are intentionally ignored — always geocode from
        // the address string for consistent accuracy across all order sources.
        const result = await this.prisma.order.createMany({
          data: orders.map((order) => ({
            establishment_id: establishmentId,
            external_id: order.id,
            address: order.address ?? 'Unknown',
            lat: null,
            lng: null,
            notes: order.comment ?? null,
            source: OrderSource.iiko,
          })),
          skipDuplicates: true,
        });

        if (result.count > 0) {
          this.logger.log(
            `[iiko:${establishmentId}] ingested ${result.count} new orders`,
          );
        }

        // Enqueue geocoding for all newly ingested orders with a valid address.
        // Fetch only orders that are still lat=null (skipDuplicates means some may
        // already exist with geocoded coords from a prior poll cycle).
        const withAddress = orders.filter(
          (o) => o.address && o.address !== 'Unknown',
        );
        if (withAddress.length > 0) {
          const forGeocode = await this.prisma.order.findMany({
            where: {
              establishment_id: establishmentId,
              external_id: { in: withAddress.map((o) => o.id) },
              lat: null,
            },
            select: { id: true, address: true },
          });
          for (const order of forGeocode) {
            void this.geocodingService.enqueueGeocode(
              order.id,
              order.address,
              establishmentId,
            );
          }
        }

        // Alert managers immediately for orders that arrived with no address at all.
        // These cannot be auto-geocoded and require manual coordinate entry.
        const unknownExternalIds = orders
          .filter((o) => !o.address || o.address === 'Unknown')
          .map((o) => o.id);
        if (unknownExternalIds.length > 0) {
          // Only alert for orders created in this cycle (not pre-existing ones)
          const newNoAddrOrders = await this.prisma.order.findMany({
            where: {
              establishment_id: establishmentId,
              external_id: { in: unknownExternalIds },
              address: 'Unknown',
              created_at: { gt: new Date(Date.now() - 120_000) },
            },
            select: { id: true, external_id: true },
          });
          for (const order of newNoAddrOrders) {
            const label = order.external_id ? ` #${order.external_id}` : '';
            void this.telegram
              .notifyEstablishmentManagers(
                establishmentId,
                `⚠️ Замовлення${label} від iiko надійшло без адреси.\nВстановіть координати вручну через кнопку «Карта» у дашборді.`,
                MANAGER_EVENT.GEOCODE_FAILED,
              )
              .catch((err) =>
                this.logger.warn(
                  `Telegram alert failed for no-address iiko order ${order.id}`,
                  err,
                ),
              );
          }
        }
      }
    } catch (err: unknown) {
      this.handlePollError(establishmentId, err);
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
    this.assertNotRateLimited(res);
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
    this.assertNotRateLimited(res);
    if (!res.ok) throw new Error(`iiko fetch orders failed: ${res.status}`);
    const data = (await res.json()) as { deliveryOrders?: IikoOrder[] };
    return data.deliveryOrders ?? [];
  }

  // ── Rate-limiting / backoff helpers ──────────────────────────────────────

  private assertNotRateLimited(res: Response): void {
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
    const current = this.backoff.get(establishmentId) ?? {
      until: 0,
      attempts: 0,
    };
    const attempts = current.attempts + 1;
    const delayMs = Math.min(
      MAX_BACKOFF_MS,
      BASE_BACKOFF_MS * Math.pow(2, attempts - 1),
    );
    this.backoff.set(establishmentId, {
      until: Date.now() + delayMs,
      attempts,
    });
    this.logger.warn(
      `[iiko:${establishmentId}] rate limited — backoff ${delayMs}ms (attempt ${attempts})`,
    );
  }

  private clearBackoff(establishmentId: string): void {
    this.backoff.delete(establishmentId);
  }

  private handlePollError(establishmentId: string, err: unknown): void {
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
