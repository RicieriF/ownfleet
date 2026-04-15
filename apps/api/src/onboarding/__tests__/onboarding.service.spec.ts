import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OnboardingService } from '../onboarding.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const EST_ID = 'est-1';
const userA: any = {
  id: 'u1',
  establishment_id: EST_ID,
  role: 'manager',
  is_platform_admin: false,
};

const baseCourier = { id: 'c1', establishment_id: EST_ID, name: 'Іван' };

const baseInvite = {
  id: 'inv-1',
  token: 'a'.repeat(64),
  courier_id: 'c1',
  establishment_id: EST_ID,
  expires_at: new Date(Date.now() + 86_400_000), // 24h from now
  used_at: null,
  establishment: { id: EST_ID, name: 'Тест Кафе' },
  courier: { id: 'c1', name: 'Іван', phone: '+380501234567' },
};

const mockCourier = { findUnique: jest.fn(), update: jest.fn() };
const mockInviteToken = {
  create: jest.fn(),
  findUnique: jest.fn(),
  findMany: jest.fn(),
  update: jest.fn(),
  updateMany: jest.fn(),
  delete: jest.fn(),
};
const mockEstablishment = {
  findUnique: jest.fn(),
  update: jest.fn(),
};
const mockUser = {
  findUnique: jest.fn(),
  create: jest.fn(),
};
const mockRefreshToken = {
  create: jest.fn(),
};
const mockPrisma = {
  courier: mockCourier,
  inviteToken: mockInviteToken,
  establishment: mockEstablishment,
  user: mockUser,
  refreshToken: mockRefreshToken,
  $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
};

const mockJwt = { sign: jest.fn().mockReturnValue('mock-access-token') };
const mockConfig = {
  getOrThrow: jest.fn().mockReturnValue('test-secret'),
  get: jest.fn(),
};

describe('OnboardingService', () => {
  let service: OnboardingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnboardingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get<OnboardingService>(OnboardingService);
    jest.clearAllMocks();

    // Default happy-path mocks
    mockCourier.findUnique.mockResolvedValue(baseCourier);
    mockInviteToken.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'inv-1', ...data }),
    );
    mockEstablishment.findUnique.mockResolvedValue({
      onboarding_status: 'pending',
    });
    mockEstablishment.update.mockResolvedValue({});
    mockInviteToken.update.mockResolvedValue({});
    mockInviteToken.updateMany.mockResolvedValue({ count: 1 });
    mockInviteToken.findUnique.mockResolvedValue(baseInvite);
    mockInviteToken.delete.mockResolvedValue({});
    mockCourier.update.mockResolvedValue({});
    mockUser.findUnique.mockResolvedValue(null); // no existing user
    mockUser.create.mockResolvedValue({
      id: 'new-user-1',
      establishment_id: EST_ID,
      role: 'dispatcher',
      email: '+380501234567',
      courier_id: 'c1',
    });
    mockRefreshToken.create.mockResolvedValue({});
    mockJwt.sign.mockReturnValue('mock-access-token');
    mockConfig.getOrThrow.mockReturnValue('test-secret');
  });

  // ── createInvite ─────────────────────────────────────────────────────────

  describe('createInvite', () => {
    it('creates an invite with a 64-char hex token', async () => {
      const result = await service.createInvite('c1', userA);

      expect(result.token).toMatch(/^[a-f0-9]{64}$/);
      expect(result.courier_id).toBe('c1');
      expect(result.expires_at).toBeInstanceOf(Date);
    });

    it('throws NotFoundException for courier from another establishment', async () => {
      mockCourier.findUnique.mockResolvedValue({
        id: 'c1',
        establishment_id: 'est-other',
      });

      await expect(service.createInvite('c1', userA)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when courier does not exist', async () => {
      mockCourier.findUnique.mockResolvedValue(null);

      await expect(service.createInvite('c-missing', userA)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('advances onboarding_status from pending to couriers_added', async () => {
      mockEstablishment.findUnique.mockResolvedValue({
        onboarding_status: 'pending',
      });

      await service.createInvite('c1', userA);

      expect(mockEstablishment.update).toHaveBeenCalledWith({
        where: { id: EST_ID },
        data: { onboarding_status: 'couriers_added' },
      });
    });

    it('does NOT downgrade onboarding_status if already past couriers_added', async () => {
      mockEstablishment.findUnique.mockResolvedValue({
        onboarding_status: 'first_order',
      });

      await service.createInvite('c1', userA);

      expect(mockEstablishment.update).not.toHaveBeenCalled();
    });
  });

  // ── acceptInvite ─────────────────────────────────────────────────────────

  describe('acceptInvite', () => {
    it('marks token as used, creates user account, and returns tokens', async () => {
      mockInviteToken.updateMany.mockResolvedValue({ count: 1 });
      mockInviteToken.findUnique.mockResolvedValue(baseInvite);
      mockUser.findUnique.mockResolvedValue(null);

      const result = await service.acceptInvite(
        baseInvite.token,
        'password123',
        'car',
      );

      expect(result.access_token).toBe('mock-access-token');
      expect(result.refresh_token).toBeDefined();
      expect(result.user.courier_id).toBe('c1');
      expect(result.user.establishment_id).toBe(EST_ID);
      expect(result.user.establishment_name).toBe('Тест Кафе');
      expect(mockInviteToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { used_at: expect.any(Date) } }),
      );
      expect(mockUser.create).toHaveBeenCalled();
      expect(mockCourier.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { transport_mode: 'car' },
      });
    });

    it('persists transport_mode on courier in the same transaction', async () => {
      mockInviteToken.updateMany.mockResolvedValue({ count: 1 });
      mockInviteToken.findUnique.mockResolvedValue(baseInvite);
      mockUser.findUnique.mockResolvedValue(null);

      await service.acceptInvite(
        baseInvite.token,
        'password123',
        'moto_electric',
      );

      expect(mockCourier.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { transport_mode: 'moto_electric' },
      });
      // Both user.create and courier.update must go through $transaction
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('throws NotFoundException for unknown token', async () => {
      mockInviteToken.updateMany.mockResolvedValue({ count: 0 });
      mockInviteToken.findUnique.mockResolvedValue(null);

      await expect(
        service.acceptInvite('bad-token', 'password123', 'car'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when token already used', async () => {
      mockInviteToken.updateMany.mockResolvedValue({ count: 0 });
      mockInviteToken.findUnique.mockResolvedValue({
        ...baseInvite,
        used_at: new Date(Date.now() - 3600_000),
      });

      await expect(
        service.acceptInvite(baseInvite.token, 'password123', 'car'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when token is expired', async () => {
      mockInviteToken.updateMany.mockResolvedValue({ count: 0 });
      mockInviteToken.findUnique.mockResolvedValue({
        ...baseInvite,
        expires_at: new Date(Date.now() - 1000),
        used_at: null,
      });

      await expect(
        service.acceptInvite(baseInvite.token, 'password123', 'car'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── revokeInvite ─────────────────────────────────────────────────────────

  describe('revokeInvite', () => {
    it('deletes the invite', async () => {
      mockInviteToken.findUnique.mockResolvedValue({ ...baseInvite });

      const result = await service.revokeInvite('inv-1', userA);

      expect(result.revoked).toBe(true);
      expect(mockInviteToken.delete).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
      });
    });

    it('throws NotFoundException for invite from another establishment', async () => {
      mockInviteToken.findUnique.mockResolvedValue({
        ...baseInvite,
        establishment_id: 'est-other',
      });

      await expect(service.revokeInvite('inv-1', userA)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when trying to revoke already-used invite', async () => {
      mockInviteToken.findUnique.mockResolvedValue({
        ...baseInvite,
        used_at: new Date(),
      });

      await expect(service.revokeInvite('inv-1', userA)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException for non-existent invite', async () => {
      mockInviteToken.findUnique.mockResolvedValue(null);

      await expect(service.revokeInvite('missing', userA)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── listInvites ───────────────────────────────────────────────────────────

  describe('listInvites', () => {
    it('returns invites filtered by establishment', async () => {
      mockInviteToken.findMany.mockResolvedValue([baseInvite]);

      const result = await service.listInvites(userA);

      expect(mockInviteToken.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { establishment_id: EST_ID },
        }),
      );
      expect(result).toHaveLength(1);
    });
  });
});
