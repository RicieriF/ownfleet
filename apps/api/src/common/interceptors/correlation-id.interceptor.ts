import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';

export const CORRELATION_ID_HEADER = 'x-request-id';

/**
 * Ensures every HTTP request has a correlation ID:
 * - Reads X-Request-Id from the incoming request header (if provided by client or upstream proxy)
 * - Generates a new UUID v4 if none was provided
 * - Echoes the ID back on the response header
 *
 * This makes it possible to tie together logs from the HTTP handler, Bull job,
 * and WebSocket events that originated from the same user action, as long as
 * the ID is forwarded through those contexts.
 */
@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    const existing = req.headers[CORRELATION_ID_HEADER] as string | undefined;
    const id = existing && existing.length <= 128 ? existing : randomUUID();

    // Expose on request so downstream handlers can read it if needed
    (req as Request & { correlationId: string }).correlationId = id;
    res.setHeader('X-Request-Id', id);

    return next.handle();
  }
}
