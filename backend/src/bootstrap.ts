import { type INestApplication, StandardSchemaValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { CONFIG, type AppConfig } from './config.js';

/** Shared HTTP hardening for the real server and the integration tests. */
export function configureApp(app: INestApplication): void {
  const config = app.get<AppConfig>(CONFIG);
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use(cookieParser());
  // Diffs are submitted as JSON; plan limits (up to 4 MB) are enforced by the review service,
  // so the parser must accept slightly more than the largest plan allows.
  (app as NestExpressApplication).useBodyParser('json', { limit: '5mb' });
  app.enableCors({ origin: [config.WEB_ORIGIN], credentials: true });
  // Zod schemas on @Body({ schema }) / @Query({ schema }) are enforced globally (422 on failure).
  app.useGlobalPipes(new StandardSchemaValidationPipe({ errorHttpStatusCode: 422 }));
  app.getHttpAdapter().getInstance().set('trust proxy', false);
  app.enableShutdownHooks();
}
