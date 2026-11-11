import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap.js';
import { CONFIG, type AppConfig } from './config.js';

// rawBody is needed to verify webhook signatures over the exact bytes received
const app = await NestFactory.create(AppModule, { bufferLogs: false, rawBody: true });
configureApp(app);
await app.listen(app.get<AppConfig>(CONFIG).PORT, '127.0.0.1');
