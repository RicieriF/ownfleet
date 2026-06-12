import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { PosterService } from '../poster.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { GeocodingService } from '../../geocoding/geocoding.service.js';
import { TelegramService } from '../../telegram/telegram.service.js';

const EST_ID = 'est-poster-1';
const APP_SECRET = 'super-secret-key';

const makeRawBody = (payload: object) => Buffer.from(JSON.stringify(payload));
const makeSignature = (secret: string, rawBody: Buffer) =>
  crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

const basePayload = {
  object: 'incoming_order',
  action: 'added',
  object_id: 'ext-order-42',
  data: {
    address: 'вул. Хрещатик 1',
    comment: 'без цибулі',
    delivery: { lat: 50.45, lng: 30.52 },
  },
};

const mockIntegration = {
  findUnique: jest.fn(),
};
const mockOrder = {
  findFirst: jest.fn(),
  create: jest.fn(),
};
const mockPrisma = { integration: mockIntegration, order: mockOrder };
const mockGeocodingService = {
  enqueueGeocode: jest.fn().mockResolvedValue(undefined),
};
const mockTelegramService = {
  notifyEstablishmentManagers: jest.fn().mockResolvedValue(undefined),
};

describe('PosterService', () => {
  let service: PosterService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PosterService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: GeocodingService, useValue: mockGeocodingService },
        { provide: TelegramService, useValue: mockTelegramService },
      ],
    }).compile();
    service = module.get<PosterService>(PosterService);
    jest.clearAllMocks();

    mockIntegration.findUnique.mockResolvedValue({
      active: true,
      config: { application_secret: APP_SECRET },
    });
    mockOrder.findFirst.mockResolvedValue(null);
    mockOrder.create.mockResolvedValue({
      id: 'order-uuid',
      external_id: 'ext-order-42',
    });
  });

  // ── HMAC validation ────────────────────────────────────────────────────

  describe('HMAC signature', () => {
    it('accepts valid HMAC signature and creates order', async () => {
      const rawBody = makeRawBody(basePayload);
      const sig = makeSignature(APP_SECRET, rawBody);

      const result = await service.handleWebhook(EST_ID, rawBody, sig);

      expect(result.received).toBe(true);
      expect(result.order_id).toBeDefined();
      expect(mockOrder.create).toHaveBeenCalledTimes(1);
    });

    it('rejects invalid signature with UnauthorizedException', async () => {
      const rawBody = makeRawBody(basePayload);

      await expect(
        service.handleWebhook(EST_ID, rawBody, 'bad-signature'),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockOrder.create).not.toHaveBeenCalled();
    });

    it('rejects missing signature with UnauthorizedException', async () => {
      const rawBody = makeRawBody(basePayload);

      await expect(
        service.handleWebhook(EST_ID, rawBody, undefined),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects when integration not found', async () => {
      mockIntegration.findUnique.mockResolvedValue(null);
      const rawBody = makeRawBody(basePayload);
      const sig = makeSignature(APP_SECRET, rawBody);

      await expect(service.handleWebhook(EST_ID, rawBody, sig)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects when integration is inactive', async () => {
      mockIntegration.findUnique.mockResolvedValue({
        active: false,
        config: {},
      });
      const rawBody = makeRawBody(basePayload);
      const sig = makeSignature(APP_SECRET, rawBody);

      await expect(service.handleWebhook(EST_ID, rawBody, sig)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ── Idempotency ────────────────────────────────────────────────────────

  describe('idempotency', () => {
    it('returns existing order without creating a duplicate', async () => {
      const existingOrder = { id: 'existing-id', external_id: 'ext-order-42' };
      mockOrder.findFirst.mockResolvedValue(existingOrder);

      const rawBody = makeRawBody(basePayload);
      const sig = makeSignature(APP_SECRET, rawBody);

      const result = await service.handleWebhook(EST_ID, rawBody, sig);

      expect(result.order_id).toBe('existing-id');
      expect(mockOrder.create).not.toHaveBeenCalled();
    });
  });

  // ── Payload filtering ──────────────────────────────────────────────────

  describe('payload filtering', () => {
    it('ignores non-incoming_order events (e.g. order_changed)', async () => {
      const payload = { ...basePayload, object: 'order', action: 'changed' };
      const rawBody = makeRawBody(payload);
      const sig = makeSignature(APP_SECRET, rawBody);

      const result = await service.handleWebhook(EST_ID, rawBody, sig);

      expect(result.received).toBe(true);
      expect(mockOrder.create).not.toHaveBeenCalled();
    });

    it('handles malformed JSON gracefully without throwing', async () => {
      const rawBody = Buffer.from('not-json');
      const sig = makeSignature(APP_SECRET, rawBody);

      const result = await service.handleWebhook(EST_ID, rawBody, sig);

      expect(result.received).toBe(true);
      expect(mockOrder.create).not.toHaveBeenCalled();
    });
  });

  // ── Order mapping ──────────────────────────────────────────────────────

  describe('order creation', () => {
    it('maps Poster payload fields to order correctly', async () => {
      const rawBody = makeRawBody(basePayload);
      const sig = makeSignature(APP_SECRET, rawBody);

      await service.handleWebhook(EST_ID, rawBody, sig);

      expect(mockOrder.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          establishment_id: EST_ID,
          external_id: 'ext-order-42',
          address: 'вул. Хрещатик 1',
          // POS coords are intentionally ignored — always geocoded from address
          lat: null,
          lng: null,
          notes: 'без цибулі',
          source: 'poster',
        }),
      });
    });
  });

  // ── Geocoding integration ──────────────────────────────────────────────────

  describe('geocoding', () => {
    it('enqueues geocoding even when payload has coordinates (POS coords not trusted)', async () => {
      const rawBody = makeRawBody(basePayload); // has lat/lng
      const sig = makeSignature(APP_SECRET, rawBody);

      await service.handleWebhook(EST_ID, rawBody, sig);

      expect(mockGeocodingService.enqueueGeocode).toHaveBeenCalledWith(
        'order-uuid',
        'вул. Хрещатик 1',
        EST_ID,
      );
    });

    it('enqueues geocoding when payload has no coordinates', async () => {
      const payloadNoCoords = {
        ...basePayload,
        data: { address: 'вул. Хрещатик 1', comment: null },
      };
      mockOrder.create.mockResolvedValue({
        id: 'order-uuid',
        external_id: 'ext-order-42',
      });

      const rawBody = makeRawBody(payloadNoCoords);
      const sig = makeSignature(APP_SECRET, rawBody);

      await service.handleWebhook(EST_ID, rawBody, sig);

      expect(mockGeocodingService.enqueueGeocode).toHaveBeenCalledWith(
        'order-uuid',
        'вул. Хрещатик 1',
        EST_ID,
      );
    });

    it('does NOT enqueue geocoding for a duplicate (existing) order', async () => {
      const existingOrder = { id: 'existing-id', external_id: 'ext-order-42' };
      mockOrder.findFirst.mockResolvedValue(existingOrder);

      const payloadNoCoords = {
        ...basePayload,
        data: { address: 'вул. Хрещатик 1' },
      };
      const rawBody = makeRawBody(payloadNoCoords);
      const sig = makeSignature(APP_SECRET, rawBody);

      await service.handleWebhook(EST_ID, rawBody, sig);

      expect(mockGeocodingService.enqueueGeocode).not.toHaveBeenCalled();
    });

    it('enqueues geocoding when payload has lat=0, lng=0 (POS sentinel for missing coords)', async () => {
      const payloadZeroCoords = {
        ...basePayload,
        data: { address: 'вул. Хрещатик 1', delivery: { lat: 0, lng: 0 } },
      };
      mockOrder.create.mockResolvedValue({
        id: 'order-uuid',
        external_id: 'ext-order-42',
      });

      const rawBody = makeRawBody(payloadZeroCoords);
      const sig = makeSignature(APP_SECRET, rawBody);

      await service.handleWebhook(EST_ID, rawBody, sig);

      expect(mockGeocodingService.enqueueGeocode).toHaveBeenCalledWith(
        'order-uuid',
        'вул. Хрещатик 1',
        EST_ID,
      );
    });
  });
});
