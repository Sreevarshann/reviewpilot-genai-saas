import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { CONFIG, type AppConfig } from './config.js';

/** Shared HTTP hardening for the real server and the integration tests. */
export function configureApp(app: INestApplication): void {
  const config = app.get<AppConfig>(CONFIG);
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: [config.WEB_ORIGIN], credentials: true });
  app.enableShutdownHooks();
}
