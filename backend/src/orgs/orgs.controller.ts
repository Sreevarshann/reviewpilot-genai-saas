import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session.service.js';
import { CurrentTenant, RequireRole, type Tenant } from '../tenancy/tenancy.js';
import { TenantGuard } from '../tenancy/tenant.guard.js';
import { AcceptInviteSchema, ChangeRoleSchema, CreateOrgSchema, InviteSchema, ProjectSchema, UpdateOrgSchema } from './orgs.schemas.js';
import { OrgsService } from './orgs.service.js';

@Controller()
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  @Post('orgs')
  create(@CurrentUser() user: SessionUser, @Body({ schema: CreateOrgSchema }) body: z.infer<typeof CreateOrgSchema>) {
    return this.orgs.create(user.id, body.name);
  }

  @Get('orgs')
  list(@CurrentUser() user: SessionUser) {
    return this.orgs.listForUser(user.id);
  }

  @Post('invitations/accept')
  @HttpCode(200)
  accept(@CurrentUser() user: SessionUser, @Body({ schema: AcceptInviteSchema }) body: z.infer<typeof AcceptInviteSchema>) {
    return this.orgs.accept(user, body.token);
  }
}

@Controller('orgs/:org')
@UseGuards(TenantGuard)
export class OrgController {
  constructor(private readonly orgs: OrgsService) {}

  @Get()
  detail(@CurrentTenant() t: Tenant) {
    return this.orgs.detail(t);
  }

  @Patch()
  @RequireRole('ADMIN')
  update(@CurrentTenant() t: Tenant, @Body({ schema: UpdateOrgSchema }) body: z.infer<typeof UpdateOrgSchema>) {
    return this.orgs.update(t, body);
  }

  @Get('members')
  members(@CurrentTenant() t: Tenant) {
    return this.orgs.members(t);
  }

  @Patch('members/:userId')
  @RequireRole('ADMIN')
  changeRole(@CurrentTenant() t: Tenant, @Param('userId') userId: string, @Body({ schema: ChangeRoleSchema }) body: z.infer<typeof ChangeRoleSchema>) {
    return this.orgs.changeRole(t, userId, body.role);
  }

  @Delete('members/:userId')
  @HttpCode(204)
  removeMember(@CurrentTenant() t: Tenant, @Param('userId') userId: string) {
    return this.orgs.removeMember(t, userId);
  }

  @Get('invitations')
  @RequireRole('ADMIN')
  invitations(@CurrentTenant() t: Tenant) {
    return this.orgs.invitations(t);
  }

  @Post('invitations')
  @RequireRole('ADMIN')
  invite(@CurrentTenant() t: Tenant, @Body({ schema: InviteSchema }) body: z.infer<typeof InviteSchema>) {
    return this.orgs.invite(t, body.email, body.role);
  }

  @Delete('invitations/:id')
  @RequireRole('ADMIN')
  @HttpCode(204)
  revoke(@CurrentTenant() t: Tenant, @Param('id') id: string) {
    return this.orgs.revokeInvitation(t, id);
  }

  @Get('projects')
  projects(@CurrentTenant() t: Tenant) {
    return this.orgs.projects(t);
  }

  @Post('projects')
  @RequireRole('ADMIN')
  createProject(@CurrentTenant() t: Tenant, @Body({ schema: ProjectSchema }) body: z.infer<typeof ProjectSchema>) {
    return this.orgs.createProject(t, body);
  }

  @Delete('projects/:id')
  @RequireRole('ADMIN')
  @HttpCode(204)
  deleteProject(@CurrentTenant() t: Tenant, @Param('id') id: string) {
    return this.orgs.deleteProject(t, id);
  }

  @Get('audit')
  @RequireRole('ADMIN')
  audit(@CurrentTenant() t: Tenant, @Query({ schema: z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }) }) q: { limit: number }) {
    return this.orgs.auditLog(t, q.limit);
  }
}
