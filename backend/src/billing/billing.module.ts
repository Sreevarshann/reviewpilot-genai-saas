import { Global, Module } from '@nestjs/common';
import { BillingController, PlansController } from './billing.controller.js';
import { UsageService } from './usage.service.js';

@Global()
@Module({ controllers: [PlansController, BillingController], providers: [UsageService], exports: [UsageService] })
export class BillingModule {}
