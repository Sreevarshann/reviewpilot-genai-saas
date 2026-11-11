import { type INestApplication, StandardSchemaValidationPipe } from '@nestjs/common';
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
  // Zod schemas on @Body({ schema }) / @Query({ schema }) are enforced globally (422 on failure).
  app.useGlobalPipes(new StandardSchemaValidationPipe({ errorHttpStatusCode: 422 }));
  app.getHttpAdapter().getInstance().set('trust proxy', false);
  app.enableShutdownHooks();
}
