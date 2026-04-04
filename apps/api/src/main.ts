import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { RedisIoAdapter } from './shared/adapters/redis-io.adapter.js';
import { CorrelationIdInterceptor } from './common/interceptors/correlation-id.interceptor.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const logger = new Logger('Bootstrap');

  // Redis-backed Socket.IO adapter — must be set before app.listen() so that
  // all WebSocket room emissions are broadcast to clients on every API instance.
  const configService = app.get(ConfigService);
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis(configService.getOrThrow<string>('REDIS_URL'));
  app.useWebSocketAdapter(redisIoAdapter);

  // Trust the first proxy hop so req.ip is populated from X-Forwarded-For.
  // INVARIANT: the API must never be directly reachable from the internet —
  // it must always sit behind exactly one trusted reverse proxy (nginx/Caddy).
  // Without this invariant, an attacker could set an arbitrary X-Forwarded-For
  // header and spoof their IP, defeating IP-based rate limiting in ApiKeyGuard.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cookieParser());

  // /health is excluded — no auth, no plan check, no versioning
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  app.useGlobalInterceptors(new CorrelationIdInterceptor());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env['PORT'] ?? 3000;
  await app.listen(port);
  logger.log(`API running on http://localhost:${port}`);
}

bootstrap();
