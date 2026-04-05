import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Request, Response } from 'express';
import { MetricsService } from './metrics.service.js';

/**
 * Records HTTP request duration into the Prometheus histogram.
 * Registered as APP_INTERCEPTOR in MetricsModule — applies to all routes.
 *
 * Route label uses Express's matched pattern (e.g. "/orders/:id") to prevent
 * high cardinality from UUIDs in URLs. Falls back to the raw URL only if no
 * route pattern is matched (should not happen in normal operation).
 *
 * Skips recording for GET /metrics itself to avoid self-referential noise.
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<Request & { route?: { path?: string } }>();

    // Skip the /metrics endpoint itself
    if (req.url === '/metrics') return next.handle();

    const { method } = req;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const res = context.switchToHttp().getResponse<Response>();
          const route = req.route?.path ?? req.url;
          this.metricsService.observeRequest(method, route, res.statusCode, Date.now() - start);
        },
        error: (err: { status?: number }) => {
          const route = req.route?.path ?? req.url;
          this.metricsService.observeRequest(method, route, err?.status ?? 500, Date.now() - start);
        },
      }),
    );
  }
}
