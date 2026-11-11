import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CurrentTenant, RequireRole, type Tenant } from '../tenancy/tenancy.js';
import { TenantGuard } from '../tenancy/tenant.guard.js';
import { ApiTokensService } from './api-tokens.service.js';
import { RetentionService } from './retention.service.js';

@Controller('orgs/:org')
@UseGuards(TenantGuard)
@RequireRole('ADMIN')
export class AdminController {
  constructor(
    private readonly tokens: ApiTokensService,
    private readonly retention: RetentionService,
  ) {}

  @Get('api-tokens')
  list(@CurrentTenant() t: Tenant) {
    return this.tokens.list(t);
  }

  @Post('api-tokens')
  create(@CurrentTenant() t: Tenant, @Body({ schema: z.object({ name: z.string().trim().min(1).max(80) }) }) body: { name: string }) {
    return this.tokens.create(t, body.name);
  }

  @Delete('api-tokens/:id')
  @HttpCode(204)
  revoke(@CurrentTenant() t: Tenant, @Param('id') id: string) {
    return this.tokens.revoke(t, id);
  }

  @Post('retention/run')
  @HttpCode(200)
  async runRetention(@CurrentTenant() t: Tenant) {
    return { deletedReviews: await this.retention.enforce(t.organizationId, t.userId) };
  }
}
