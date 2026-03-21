import {
  Controller,
  Post,
  Param,
  Req,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { PosterService } from './poster.service.js';

/**
 * Inbound Poster POS webhook.
 * No JWT/PlanAccessGuard — this endpoint receives calls from Poster's servers.
 * Authentication is done via HMAC-SHA256 signature on the raw body.
 */
@Controller('integrations/poster')
export class PosterController {
  constructor(private readonly posterService: PosterService) {}

  @Post('webhook/:establishmentId')
  @HttpCode(HttpStatus.OK)
  handleWebhook(
    @Param('establishmentId') establishmentId: string,
    @Req() req: any,
    @Headers('x-poster-signature') signature: string | undefined,
  ) {
    // rawBody is available because NestFactory.create was called with { rawBody: true }
    const rawBody: Buffer = req.rawBody as Buffer;
    return this.posterService.handleWebhook(establishmentId, rawBody, signature);
  }
}
