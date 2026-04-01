import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import { ApiKeysService } from '../api-keys.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const EST_A = 'est-a';
const EST_B = 'est-b';

const ownerUser: any = { id: 'u1', establishment_id: EST_A, role: 'owner', is_platform_admin: false };
const otherUser: any = { id: 'u2', establishment_id: EST_B, role: 'owner', is_platform_admin: false };

const API_KEY_SECRET = 'test-secret-32-bytes-exactly!!!!';

const mockApiKey = {
  findFirst: jest.fn(),
  findUnique: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
};

const mockPrisma = { apiKey: mockApiKey };

function hmac(key: string): string {
  return crypto.createHmac('sha256', API_KEY_SECRET).update(key).digest('hex');
}

describe('ApiKeysService', () => {
  let service: ApiKeysService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeysService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: ConfigService,
          useValue: { getOrThrow: (_k: string) => API_KEY_SECRET },
        },
      ],
    }).compile();

    service = module.get<ApiKeysService>(ApiKeysService);
    jest.clearAllMocks();
  });

  // ── createKey ──────────────────────────────────────────────────────────────

  describe('createKey', () => {
    it('creates a key with wgo_ prefix and returns plaintext once', async () => {
      const dto = { name: 'Test Key', website_url: 'https://pizza.com' };
      mockApiKey.create.mockResolvedValue({ id: 'key-id', key_prefix: 'wgo_xxxx' });

      const result = await service.createKey(dto, ownerUser);

      expect(result.key).toMatch(/^wgo_/);
      expect(result.id).toBe('key-id');
      // key_prefix is first 8 chars of the generated key — verify structure
      expect(result.key_prefix).toBe(result.key.slice(0, 8));

      // Verify that the stored hash matches the key
      const call = mockApiKey.create.mock.calls[0][0].data;
      expect(call.establishment_id).toBe(EST_A);
      expect(call.name).toBe('Test Key');
      expect(call.is_active).toBe(true);
      // HMAC of the returned key should match what was stored
      expect(hmac(result.key)).toBe(call.key_hash);
    });

    it('auto-expands website_url to include www variant', async () => {
      mockApiKey.create.mockResolvedValue({ id: 'key-id', key_prefix: 'wgo_xxxx' });

      await service.createKey({ name: 'K', website_url: 'pizza.com' }, ownerUser);

      const call = mockApiKey.create.mock.calls[0][0].data;
      expect(call.allowed_domains).toContain('pizza.com');
      expect(call.allowed_domains).toContain('www.pizza.com');
    });

    it('sets empty allowed_domains when no website_url provided', async () => {
      mockApiKey.create.mockResolvedValue({ id: 'key-id', key_prefix: 'wgo_xxxx' });

      await service.createKey({ name: 'K' }, ownerUser);

      const call = mockApiKey.create.mock.calls[0][0].data;
      expect(call.allowed_domains).toEqual([]);
    });
  });

  // ── verifyKey ──────────────────────────────────────────────────────────────

  describe('verifyKey', () => {
    it('returns null for too-short key', async () => {
      const result = await service.verifyKey('short');
      expect(result).toBeNull();
      expect(mockApiKey.findUnique).not.toHaveBeenCalled();
    });

    it('returns null when prefix not found in DB', async () => {
      mockApiKey.findUnique.mockResolvedValue(null);
      const result = await service.verifyKey('wgo_unknown_key_abc123');
      expect(result).toBeNull();
    });

    it('returns null when key is inactive', async () => {
      const fakeKey = 'wgo_testkey_abc123def456xyz';
      mockApiKey.findUnique.mockResolvedValue({
        id: 'k1',
        establishment_id: EST_A,
        key_hash: hmac(fakeKey),
        is_active: false,
        allowed_domains: ['pizza.com'],
        key_prefix: fakeKey.slice(0, 8),
      });

      const result = await service.verifyKey(fakeKey);
      expect(result).toBeNull();
    });

    it('returns null when HMAC does not match (wrong key, timing-safe)', async () => {
      const realKey = 'wgo_realkey_abc123def456xyz!!';
      const wrongKey = 'wgo_realkey_WRONG3def456xyz!!';
      mockApiKey.findUnique.mockResolvedValue({
        id: 'k1',
        establishment_id: EST_A,
        key_hash: hmac(realKey),
        is_active: true,
        allowed_domains: ['pizza.com'],
        key_prefix: realKey.slice(0, 8),
      });

      const result = await service.verifyKey(wrongKey);
      expect(result).toBeNull();
    });

    it('returns key record for a valid, active key', async () => {
      const realKey = 'wgo_validkey_abc123def456xyz!';
      mockApiKey.findUnique.mockResolvedValue({
        id: 'k1',
        establishment_id: EST_A,
        key_hash: hmac(realKey),
        is_active: true,
        allowed_domains: ['pizza.com', 'www.pizza.com'],
        key_prefix: realKey.slice(0, 8),
      });

      const result = await service.verifyKey(realKey);
      expect(result).not.toBeNull();
      expect(result!.establishment_id).toBe(EST_A);
      expect(result!.allowed_domains).toContain('pizza.com');
    });
  });

  // ── toggleActive ──────────────────────────────────────────────────────────

  describe('toggleActive', () => {
    it('throws NotFoundException when key not found', async () => {
      mockApiKey.findUnique.mockResolvedValue(null);
      await expect(service.toggleActive('k1', ownerUser)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when key belongs to different establishment', async () => {
      mockApiKey.findUnique.mockResolvedValue({ id: 'k1', establishment_id: EST_B, is_active: true });
      await expect(service.toggleActive('k1', ownerUser)).rejects.toThrow(NotFoundException);
    });

    it('toggles is_active from true to false', async () => {
      mockApiKey.findUnique.mockResolvedValue({ id: 'k1', establishment_id: EST_A, is_active: true });
      mockApiKey.update.mockResolvedValue({});

      await service.toggleActive('k1', ownerUser);

      expect(mockApiKey.update).toHaveBeenCalledWith({
        where: { id: 'k1' },
        data: { is_active: false },
      });
    });

    it('toggles is_active from false to true', async () => {
      mockApiKey.findUnique.mockResolvedValue({ id: 'k1', establishment_id: EST_A, is_active: false });
      mockApiKey.update.mockResolvedValue({});

      await service.toggleActive('k1', ownerUser);

      expect(mockApiKey.update).toHaveBeenCalledWith({
        where: { id: 'k1' },
        data: { is_active: true },
      });
    });
  });

  // ── expandDomains ─────────────────────────────────────────────────────────

  describe('expandDomains', () => {
    it('expands bare domain to include www variant', () => {
      expect(service.expandDomains('pizza.com')).toEqual(
        expect.arrayContaining(['pizza.com', 'www.pizza.com']),
      );
    });

    it('expands www domain to include non-www variant', () => {
      expect(service.expandDomains('www.pizza.com')).toEqual(
        expect.arrayContaining(['www.pizza.com', 'pizza.com']),
      );
    });

    it('strips protocol and path before expanding', () => {
      expect(service.expandDomains('https://pizza.com/menu')).toEqual(
        expect.arrayContaining(['pizza.com', 'www.pizza.com']),
      );
    });

    it('returns empty array for empty string', () => {
      expect(service.expandDomains('')).toEqual([]);
    });
  });

  // ── updateLastUsed (fire-and-forget) ────────────────────────────────────

  describe('updateLastUsed', () => {
    it('updates last_used_at and last_used_domain without throwing', () => {
      mockApiKey.update.mockResolvedValue({});
      expect(() => service.updateLastUsed('k1', 'pizza.com')).not.toThrow();
      expect(mockApiKey.update).toHaveBeenCalledWith({
        where: { id: 'k1' },
        data: { last_used_at: expect.any(Date), last_used_domain: 'pizza.com' },
      });
    });
  });
});
