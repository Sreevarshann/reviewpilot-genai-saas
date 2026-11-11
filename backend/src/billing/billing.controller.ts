import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../auth/decorators.js';
import { CurrentTenant, RequireRole, type Tenant } from '../tenancy/tenancy.js';
import { TenantGuard } from '../tenancy/tenant.guard.js';
import { PLANS } from './plans.js';
import { UsageService } from './usage.service.js';

@Controller()
export class PlansController {
  @Public()
  @Get('plans')
  plans() {
    return { note: 'Local demo tiers. Not purchasable: no payment provider is configured.', plans: Object.entries(PLANS).map(([id, p]) => ({ id, ...p })) };
  }
}

@Controller('orgs/:org')
@UseGuards(TenantGuard)
export class BillingController {
  constructor(private readonly usage: UsageService) {}

  @Get('usage')
  summary(@CurrentTenant() t: Tenant) {
    return this.usage.summary(t);
  }

  @Post('billing/plan')
  @RequireRole('OWNER')
  @HttpCode(200)
  changePlan(@CurrentTenant() t: Tenant, @Body({ schema: z.object({ plan: z.enum(['FREE', 'TEAM', 'BUSINESS']) }) }) body: { plan: 'FREE' | 'TEAM' | 'BUSINESS' }) {
    return this.usage.changePlan(t, body.plan);
  }
}
