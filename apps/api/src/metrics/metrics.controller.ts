import { Controller, Get, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { MetricsService } from './metrics.service.js';

/**
 * Exposes Prometheus metrics at GET /metrics.
 *
 * Security model:
 * - If METRICS_SECRET is set: requires "Authorization: Bearer <secret>" header.
 *   Grafana Alloy is configured to send this header on every scrape.
 * - If METRICS_SECRET is not set: open access (acceptable in local dev).
 * - The reverse proxy (nginx/Caddy) MUST NOT expose this route to the internet.
 *   It should only be reachable from Alloy running on the same host or private network.
 *
 * Excluded from the global /api/v1 prefix (see main.ts).
 * Excluded from throttling since Alloy scrapes from a single IP at low frequency.
 */
@SkipThrottle()
@Controller('metrics')
export class MetricsController {
  private readonly secret: string | undefined;

  constructor(private readonly metricsService: MetricsService) {
    this.secret = process.env['METRICS_SECRET'];
  }

  @Get()
  async get(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (this.secret) {
      const auth = req.headers['authorization'];
      if (auth !== `Bearer ${this.secret}`) {
        res.status(401).end('Unauthorized');
        return;
      }
    }

    const [text, contentType] = await Promise.all([
      this.metricsService.getMetricsText(),
      Promise.resolve(this.metricsService.getContentType()),
    ]);

    res.setHeader('Content-Type', contentType);
    res.end(text);
  }
}
