import { SetMetadata } from '@nestjs/common';

/**
 * Marks an endpoint as returning sensitive data (e.g. plaintext credentials).
 *
 * Any logging interceptor MUST check this metadata via Reflector and skip
 * response-body logging for routes decorated with @SensitiveResponse().
 *
 * Usage:
 *   @SensitiveResponse()
 *   @Post('establishments')
 *   createEstablishment(...) { ... }
 */
export const SENSITIVE_RESPONSE_KEY = 'sensitiveResponse';
export const SensitiveResponse = () =>
  SetMetadata(SENSITIVE_RESPONSE_KEY, true);
