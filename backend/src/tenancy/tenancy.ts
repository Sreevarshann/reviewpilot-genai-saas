import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '../generated/prisma/enums.js';
import type { AuthedRequest } from '../auth/decorators.js';

export const ROLE_RANK: Record<Role, number> = { VIEWER: 0, REVIEWER: 1, ADMIN: 2, OWNER: 3 };

export interface Tenant {
  organizationId: string;
  slug: string;
  role: Role;
  plan: 'FREE' | 'TEAM' | 'BUSINESS';
  userId: string | null; // null when authenticated by an org API token
  via: 'session' | 'api_token';
}

export type TenantRequest = AuthedRequest & { tenant?: Tenant };

export const MIN_ROLE = 'rp:min-role';
/** Minimum role within the organization for a route (default: any member, i.e. VIEWER). */
export const RequireRole = (role: Role) => SetMetadata(MIN_ROLE, role);

export const CurrentTenant = createParamDecorator((_: unknown, ctx: ExecutionContext): Tenant => {
  const t = ctx.switchToHttp().getRequest<TenantRequest>().tenant;
  if (!t) throw new Error('CurrentTenant used outside an organization route');
  return t;
});
