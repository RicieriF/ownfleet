import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TrackingGateway } from '../tracking.gateway.js';
import { REDIS_SUBSCRIBER } from '../redis.provider.js';

const mockSocket = (token?: string) => ({
  id: 'socket-1',
  handshake: {
    auth: token ? { token } : {},
    headers: {},
  },
  join: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn(),
});

const mockRedisSub = {
  subscribe: jest.fn(),
  on: jest.fn(),
};

const mockJwt = { verify: jest.fn() };
const mockConfig = { getOrThrow: jest.fn().mockReturnValue('test-secret') };

describe('TrackingGateway', () => {
  let gateway: TrackingGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrackingGateway,
        { provide: JwtService, useValue: mockJwt },
        { provide: ConfigService, useValue: mockConfig },
        { provide: REDIS_SUBSCRIBER, useValue: mockRedisSub },
      ],
    }).compile();
    gateway = module.get<TrackingGateway>(TrackingGateway);
    jest.clearAllMocks();
    mockConfig.getOrThrow.mockReturnValue('test-secret');
    mockRedisSub.subscribe.mockImplementation((_ch: string, cb: (e: null) => void) => cb(null));
    mockRedisSub.on.mockImplementation(() => {});
  });

  describe('handleConnection (P0 — WS auth)', () => {
    it('disconnects socket with no token', () => {
      const socket = mockSocket() as any;
      gateway.handleConnection(socket);
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('disconnects socket with invalid token', () => {
      mockJwt.verify.mockImplementation(() => { throw new Error('invalid'); });
      const socket = mockSocket('bad.token') as any;
      gateway.handleConnection(socket);
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('joins establishment room on valid token', () => {
      mockJwt.verify.mockReturnValue({
        sub: 'u1',
        establishment_id: 'est-1',
        role: 'manager',
        is_platform_admin: false,
      });
      const socket = mockSocket('valid.token') as any;
      gateway.handleConnection(socket);
      expect(socket.join).toHaveBeenCalledWith('est:est-1');
      expect(socket.disconnect).not.toHaveBeenCalled();
    });

    it('joins correct room for different establishments', () => {
      mockJwt.verify.mockReturnValue({
        sub: 'u2', establishment_id: 'est-99', role: 'owner', is_platform_admin: false,
      });
      const socket = mockSocket('valid.token') as any;
      gateway.handleConnection(socket);
      expect(socket.join).toHaveBeenCalledWith('est:est-99');
    });
  });
});
