import { Controller, Get } from '@nestjs/common';

/**
 * Health check — excluded from global prefix and all guards.
 * Responds at GET /health (not /api/v1/health).
 * Used by load balancers, uptime monitors, and docker healthcheck.
 */
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
