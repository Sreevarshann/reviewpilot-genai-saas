import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CurrentTenant, type Tenant } from '../tenancy/tenancy.js';
import { TenantGuard } from '../tenancy/tenant.guard.js';
import { AnalyticsService } from './analytics.service.js';

const Q = z.object({ days: z.coerce.number().int().min(1).max(365).default(30), projectId: z.string().min(1).max(40).optional() });

@Controller('orgs/:org/analytics')
@UseGuards(TenantGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get()
  overview(@CurrentTenant() t: Tenant, @Query({ schema: Q }) q: z.infer<typeof Q>) {
    return this.analytics.overview(t, q.days, q.projectId);
  }
}
