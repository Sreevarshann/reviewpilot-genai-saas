import { Global, Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { TenantGuard } from '../tenancy/tenant.guard.js';
import { OrgController, OrgsController } from './orgs.controller.js';
import { OrgsService } from './orgs.service.js';

@Global()
@Module({ controllers: [OrgsController, OrgController], providers: [OrgsService, AuditService, TenantGuard], exports: [OrgsService, AuditService, TenantGuard] })
export class OrgsModule {}
