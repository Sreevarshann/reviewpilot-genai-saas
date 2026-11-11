import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module.js';
import { AppConfigModule } from './common/config.module.js';
import { FindingsModule } from './findings/findings.module.js';
import { HealthModule } from './health/health.module.js';
import { OrgsModule } from './orgs/orgs.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ReviewModule } from './review/review.module.js';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 300) }] }),
    AuthModule,
    OrgsModule,
    BullModule.forRoot({ connection: { url: process.env.REDIS_URL ?? 'redis://127.0.0.1:56503' }, prefix: 'reviewpilot' }),
    ReviewModule,
    FindingsModule,
    HealthModule,
  ],
  // Throttler runs before authentication so brute force is limited even for bad credentials.
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
