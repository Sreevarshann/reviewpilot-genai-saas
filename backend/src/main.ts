import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap.js';
import { CONFIG, type AppConfig } from './config.js';

const app = await NestFactory.create(AppModule, { bufferLogs: false });
configureApp(app);
await app.listen(app.get<AppConfig>(CONFIG).PORT, '127.0.0.1');
