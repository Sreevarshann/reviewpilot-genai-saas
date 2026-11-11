import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '../../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MIN_ROLE, ROLE_RANK, type TenantRequest } from './tenancy.js';

/**
 * Resolves `:org` (slug) to a membership of the signed-in user (or the org of an API token).
 * Non-members get 404 rather than 403 so organization existence is not disclosed.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<TenantRequest>();
    const slug = String(req.params.org ?? '');
    const org = await this.prisma.organization.findUnique({ where: { slug }, select: { id: true, slug: true, plan: true } });
    if (!org) throw new NotFoundException({ error: 'not_found', message: 'Organization not found' });
    let role: Role | null = null;
    if (req.user) {
      const m = await this.prisma.membership.findUnique({ where: { organizationId_userId: { organizationId: org.id, userId: req.user.id } }, select: { role: true } });
      role = m?.role ?? null;
    } else if (req.apiToken && req.apiToken.organizationId === org.id) {
      role = 'REVIEWER'; // API tokens can submit and read reviews, never administer
    }
    if (!role) throw new NotFoundException({ error: 'not_found', message: 'Organization not found' });
    const needed = this.reflector.getAllAndOverride<Role | undefined>(MIN_ROLE, [ctx.getHandler(), ctx.getClass()]) ?? 'VIEWER';
    if (ROLE_RANK[role] < ROLE_RANK[needed]) throw new ForbiddenException({ error: 'forbidden', message: `Requires ${needed.toLowerCase()} role` });
    req.tenant = { organizationId: org.id, slug: org.slug, role, plan: org.plan, userId: req.user?.id ?? null, via: req.user ? 'session' : 'api_token' };
    return true;
  }
}
