import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  Req,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PlanAccessGuard } from '../establishments/guards/plan-access.guard.js';
import { PublicTrackingService } from './public-tracking.service.js';
import { ApiKeyGuard } from './guards/api-key.guard.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { ApiKeyContext } from './guards/api-key.guard.js';

@Controller('api/v1')
export class PublicTrackingController {
  constructor(private readonly service: PublicTrackingService) {}

  /**
   * Public: get or create tracking token by order external_id.
   * Requires a valid API key with an allowed domain.
   * Scoped to the establishment bound to the API key.
   * URL matches tracker.js spec: GET /api/v1/public/order/:externalId/token?key=API_KEY
   */
  @UseGuards(ApiKeyGuard)
  @Get('public/order/:externalId/token')
  async getPublicToken(
    @Param('externalId') externalId: string,
    @Req() req: Request,
  ) {
    const apiKey = req.apiKey as ApiKeyContext;
    return this.service.getTokenByExternalId(externalId, apiKey.establishment_id);
  }

  /**
   * Public: snapshot of current order/delivery state.
   * Requires a valid tracking token.
   */
  @Get('public/track/:token')
  async getSnapshot(@Param('token') token: string) {
    const snapshot = await this.service.getSnapshot(token);
    if (!snapshot) {
      throw new NotFoundException('Tracking token not found or expired');
    }
    return snapshot;
  }

  /**
   * Manager: generate tracking token for a specific order.
   * Requires JWT auth + PlanAccessGuard.
   * Multi-tenant scoped: manager can only get tokens for their own orders.
   */
  @UseGuards(JwtAuthGuard, PlanAccessGuard)
  @Post('orders/:id/tracking-token')
  getManagerToken(@Param('id') id: string, @Req() req: Request) {
    return this.service.getTokenForManager(id, req.user as AuthenticatedUser);
  }
}
