import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap.js';
import { CONFIG, type AppConfig } from './config.js';

// rawBody is needed to verify webhook signatures over the exact bytes received
const app = await NestFactory.create(AppModule, { bufferLogs: false, rawBody: true });
configureApp(app);
const config = app.get<AppConfig>(CONFIG);
// HOST defaults to loopback; containers set HOST=0.0.0.0 behind a localhost-only port mapping
await app.listen(config.PORT, config.HOST);
