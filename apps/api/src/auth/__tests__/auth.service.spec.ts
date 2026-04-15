import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import * as bcrypt from 'bcrypt';

const mockUser = {
  id: 'user-1',
  email: 'manager@test.com',
  password_hash: '',
  establishment_id: 'est-1',
  role: 'manager' as const,
  is_platform_admin: false,
  establishment: {
    id: 'est-1',
    plan: 'starter',
    trial_ends_at: null,
    paid_until: null,
  },
};

const mockPrisma = {
  user: { findUnique: jest.fn() },
  refreshToken: {
    create: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
  },
};

const mockJwt = { sign: jest.fn().mockReturnValue('access.token.here') };
const mockConfig = { getOrThrow: jest.fn().mockReturnValue('test-secret') };

describe('AuthService', () => {
  let service: AuthService;

  beforeAll(async () => {
    mockUser.password_hash = await bcrypt.hash('password123', 10);
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
    mockJwt.sign.mockReturnValue('access.token.here');
    mockConfig.getOrThrow.mockReturnValue('test-secret');
    mockPrisma.refreshToken.create.mockResolvedValue({});
  });

  describe('login', () => {
    it('returns tokens on valid credentials', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.login({
        email: 'manager@test.com',
        password: 'password123',
      });

      expect(result.accessToken).toBe('access.token.here');
      expect(result.refreshToken).toBeDefined();
      expect(typeof result.refreshToken).toBe('string');
    });

    it('throws UnauthorizedException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@test.com', password: 'pass' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException on wrong password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(
        service.login({ email: 'manager@test.com', password: 'wrongpass' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('JWT payload contains sub, establishment_id, role', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      await service.login({
        email: 'manager@test.com',
        password: 'password123',
      });

      expect(mockJwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'user-1',
          establishment_id: 'est-1',
          role: 'manager',
        }),
        expect.any(Object),
      );
    });
  });

  describe('refresh', () => {
    // refresh() now uses delete({where, include}) atomically — mock accordingly

    it('throws UnauthorizedException when token not found', async () => {
      mockPrisma.refreshToken.delete.mockRejectedValue(new Error('not found'));

      await expect(service.refresh('invalid-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when token expired', async () => {
      mockPrisma.refreshToken.delete.mockResolvedValue({
        id: 'rt-1',
        expires_at: new Date(Date.now() - 1000),
        user: mockUser,
      });

      await expect(service.refresh('expired-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rotates token and returns new pair', async () => {
      mockPrisma.refreshToken.delete.mockResolvedValue({
        id: 'rt-1',
        expires_at: new Date(Date.now() + 60_000),
        user: { ...mockUser, is_platform_admin: false },
      });

      const result = await service.refresh('valid-token');

      expect(mockPrisma.refreshToken.delete).toHaveBeenCalledTimes(1);
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });
  });

  describe('logout', () => {
    it('deletes refresh token', async () => {
      mockPrisma.refreshToken.delete.mockResolvedValue({});

      await service.logout('some-raw-token');

      expect(mockPrisma.refreshToken.delete).toHaveBeenCalledTimes(1);
    });

    it('does not throw when token already gone', async () => {
      mockPrisma.refreshToken.delete.mockRejectedValue(new Error('not found'));

      await expect(service.logout('gone-token')).resolves.not.toThrow();
    });
  });
});
