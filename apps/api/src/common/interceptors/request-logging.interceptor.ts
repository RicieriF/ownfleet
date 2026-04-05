import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Request, Response } from 'express';

/**
 * Logs every HTTP request with method, path, status code, duration, and correlation ID.
 * Format: "GET /api/v1/orders 200 +34ms [abc-123]"
 *
 * Must run AFTER CorrelationIdInterceptor so req.correlationId is already populated.
 * Errors (4xx/5xx) are logged as warn to allow easy log-level filtering.
 */
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<Request & { correlationId?: string }>();
    const { method, url } = req;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const res = context.switchToHttp().getResponse<Response>();
          const duration = Date.now() - start;
          this.logger.log(
            `${method} ${url} ${res.statusCode} +${duration}ms [${req.correlationId ?? '-'}]`,
          );
        },
        error: (err: { status?: number }) => {
          const duration = Date.now() - start;
          const status = err?.status ?? 500;
          this.logger.warn(
            `${method} ${url} ${status} +${duration}ms [${req.correlationId ?? '-'}]`,
          );
        },
      }),
    );
  }
}
