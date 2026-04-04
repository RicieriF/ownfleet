import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { ConfigService } from '@nestjs/config';
import { AuthenticatedUser } from '../auth/auth.types.js';
import { CreateApiKeyDto } from './dto/create-api-key.dto.js';
import { API_KEY_PREFIX, API_KEY_PREFIX_LENGTH } from './api-keys.constants.js';

@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);
  private readonly apiKeySecret: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.apiKeySecret = config.getOrThrow<string>('API_KEY_SECRET');
  }

  /**
   * Generates a new API key for the establishment.
   * The key is returned only once — only the HMAC hash is stored in DB.
   * Auto-expands the website URL to include www variant.
   */
  async createKey(
    dto: CreateApiKeyDto,
    user: AuthenticatedUser,
  ): Promise<{ key: string; id: string; key_prefix: string }> {
    this.assertManagerOrOwner(user);
    const allowedDomains = dto.website_url ? this.expandDomains(dto.website_url) : [];

    // Retry up to 3 times on key_prefix collision (P2002 unique constraint).
    // Probability per attempt is ~1/16M, but a retry loop makes failures impossible
    // in practice rather than surfacing a 500 to the user.
    for (let attempt = 1; attempt <= 3; attempt++) {
      const rawBytes = crypto.randomBytes(24); // 192 bits of entropy
      const key = API_KEY_PREFIX + rawBytes.toString('base64url');
      const keyPrefix = key.slice(0, API_KEY_PREFIX_LENGTH);

      const keyHash = crypto
        .createHmac('sha256', this.apiKeySecret)
        .update(key)
        .digest('hex');

      try {
        const record = await this.prisma.apiKey.create({
          data: {
            establishment_id: user.establishment_id,
            key_hash: keyHash,
            key_prefix: keyPrefix,
            name: dto.name ?? 'Default',
            is_active: true,
            allowed_domains: allowedDomains,
          },
        });

        this.logger.log(`API key created for establishment ${user.establishment_id}: ${keyPrefix}...`);
        return { key, id: record.id, key_prefix: keyPrefix };
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          attempt < 3
        ) {
          this.logger.warn(`key_prefix collision on attempt ${attempt}, retrying`);
          continue;
        }
        throw err;
      }
    }

    // Unreachable — loop always returns or throws within 3 attempts.
    throw new Error('Failed to generate a unique API key prefix');
  }

  /**
   * Returns the API key metadata (without the key itself — it's never stored in plaintext).
   */
  async getKey(user: AuthenticatedUser) {
    this.assertManagerOrOwner(user);
    const key = await this.prisma.apiKey.findFirst({
      where: { establishment_id: user.establishment_id },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        key_prefix: true,
        name: true,
        is_active: true,
        allowed_domains: true,
        last_used_at: true,
        last_used_domain: true,
        created_at: true,
      },
    });
    return key ?? null;
  }

  /**
   * Toggles is_active on the API key.
   */
  async toggleActive(id: string, user: AuthenticatedUser): Promise<void> {
    this.assertManagerOrOwner(user);
    const key = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!key || key.establishment_id !== user.establishment_id) {
      throw new NotFoundException('API key not found');
    }

    await this.prisma.apiKey.update({
      where: { id },
      data: { is_active: !key.is_active },
    });
  }

  /**
   * Updates allowed_domains for the API key (e.g. from /settings website URL change).
   * Auto-expands to include www variant.
   */
  async updateDomains(id: string, websiteUrl: string, user: AuthenticatedUser): Promise<void> {
    this.assertManagerOrOwner(user);
    const key = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!key || key.establishment_id !== user.establishment_id) {
      throw new NotFoundException('API key not found');
    }

    let allowedDomains: string[];
    try {
      allowedDomains = websiteUrl.trim() ? this.expandDomains(websiteUrl) : [];
    } catch {
      throw new BadRequestException('Invalid website URL — must be a valid domain (e.g. pizza.com)');
    }
    await this.prisma.apiKey.update({
      where: { id },
      data: { allowed_domains: allowedDomains },
    });
  }

  private assertManagerOrOwner(user: AuthenticatedUser): void {
    if (user.role !== 'owner' && user.role !== 'manager') {
      throw new ForbiddenException('Insufficient permissions');
    }
  }

  /**
   * Verifies an API key and returns the key record if valid.
   * Used by ApiKeyGuard. Throws if the key is invalid or inactive.
   *
   * timingSafeEqual prevents timing attacks on HMAC comparison.
   */
  async verifyKey(rawKey: string): Promise<{
    id: string;
    establishment_id: string;
    allowed_domains: string[];
    key_prefix: string;
  } | null> {
    if (!rawKey || rawKey.length < API_KEY_PREFIX_LENGTH) return null;

    const keyPrefix = rawKey.slice(0, API_KEY_PREFIX_LENGTH);
    const record = await this.prisma.apiKey.findUnique({
      where: { key_prefix: keyPrefix },
      select: {
        id: true,
        establishment_id: true,
        key_hash: true,
        is_active: true,
        allowed_domains: true,
        key_prefix: true,
      },
    });

    if (!record) return null;
    if (!record.is_active) return null;

    const expected = crypto
      .createHmac('sha256', this.apiKeySecret)
      .update(rawKey)
      .digest('hex');

    const expectedBuf = Buffer.from(expected, 'utf8');
    const storedBuf = Buffer.from(record.key_hash, 'utf8');

    if (
      expectedBuf.length !== storedBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, storedBuf)
    ) {
      return null;
    }

    return {
      id: record.id,
      establishment_id: record.establishment_id,
      allowed_domains: record.allowed_domains,
      key_prefix: record.key_prefix,
    };
  }

  /**
   * Records last_used_at and last_used_domain — fire-and-forget.
   */
  updateLastUsed(keyId: string, domain: string | null): void {
    this.prisma.apiKey
      .update({
        where: { id: keyId },
        data: { last_used_at: new Date(), last_used_domain: domain },
      })
      .catch((err: unknown) => this.logger.warn('Failed to update last_used_at', err));
  }

  /**
   * Expands a website URL to include/exclude www variant.
   * "pizza.com" → ['pizza.com', 'www.pizza.com']
   * "www.pizza.com" → ['www.pizza.com', 'pizza.com']
   */
  expandDomains(websiteUrl: string): string[] {
    let host = websiteUrl.trim().toLowerCase();
    // Strip protocol and path
    host = host.replace(/^https?:\/\//, '').split('/')[0]!;
    if (!host) return [];

    // Validate: must be a proper hostname (letters, digits, hyphens, dots; at least one dot; valid TLD ≥ 2 chars)
    // Rejects: localhost, IPs, spaces, special chars, single-label domains
    const HOSTNAME_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
    if (!HOSTNAME_RE.test(host)) {
      throw new Error(`Invalid domain: "${host}"`);
    }

    const domains = new Set<string>([host]);
    if (host.startsWith('www.')) {
      domains.add(host.slice(4)); // strip www.
    } else {
      domains.add(`www.${host}`);
    }
    return [...domains];
  }
}
