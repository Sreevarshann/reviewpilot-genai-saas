import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Role } from '../../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import { PLANS } from '../billing/plans.js';
import { randomToken, sha256 } from '../common/crypto.js';
import { CONFIG, type AppConfig } from '../config.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Tenant } from '../tenancy/tenancy.js';

const INVITE_TTL_MS = 7 * 86_400_000;

function slugify(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'org';
}

@Injectable()
export class OrgsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async create(userId: string, name: string) {
    const base = slugify(name);
    for (let i = 0; i < 20; i++) {
      const slug = i === 0 ? base : `${base}-${i + 1}`;
      try {
        const org = await this.prisma.organization.create({ data: { name, slug, memberships: { create: { userId, role: 'OWNER' } } } });
        await this.audit.record({ organizationId: org.id, actorId: userId, action: 'org.created', targetType: 'organization', targetId: org.id });
        return org;
      } catch (e) {
        if ((e as { code?: string }).code !== 'P2002') throw e;
      }
    }
    throw new ConflictException({ error: 'slug_taken', message: 'Could not allocate an organization slug' });
  }

  listForUser(userId: string) {
    return this.prisma.membership.findMany({ where: { userId }, select: { role: true, organization: { select: { id: true, name: true, slug: true, plan: true } } }, orderBy: { createdAt: 'asc' } });
  }

  async detail(t: Tenant) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: t.organizationId }, select: { id: true, name: true, slug: true, plan: true, retentionDays: true, createdAt: true, _count: { select: { memberships: true, projects: true } } } });
    return { ...org, role: t.role, limits: PLANS[org.plan] };
  }

  async update(t: Tenant, data: { name?: string; retentionDays?: number }) {
    const org = await this.prisma.organization.update({ where: { id: t.organizationId }, data });
    await this.audit.record({ organizationId: t.organizationId, actorId: t.userId, action: 'org.updated', metadata: data });
    return org;
  }

  members(t: Tenant) {
    return this.prisma.membership.findMany({ where: { organizationId: t.organizationId }, select: { role: true, createdAt: true, user: { select: { id: true, email: true, name: true } } }, orderBy: { createdAt: 'asc' } });
  }

  private async ownerCount(orgId: string): Promise<number> {
    return this.prisma.membership.count({ where: { organizationId: orgId, role: 'OWNER' } });
  }

  async changeRole(t: Tenant, userId: string, role: Role) {
    const m = await this.prisma.membership.findUnique({ where: { organizationId_userId: { organizationId: t.organizationId, userId } } });
    if (!m) throw new NotFoundException({ error: 'not_found', message: 'Member not found' });
    if ((role === 'OWNER' || m.role === 'OWNER' || role === 'ADMIN' || m.role === 'ADMIN') && t.role !== 'OWNER') throw new ForbiddenException({ error: 'forbidden', message: 'Only owners can grant or change admin and owner roles' });
    if (m.role === 'OWNER' && role !== 'OWNER' && (await this.ownerCount(t.organizationId)) <= 1) throw new BadRequestException({ error: 'last_owner', message: 'An organization needs at least one owner' });
    const updated = await this.prisma.membership.update({ where: { id: m.id }, data: { role } });
    await this.audit.record({ organizationId: t.organizationId, actorId: t.userId, action: 'member.role_changed', targetType: 'user', targetId: userId, metadata: { from: m.role, to: role } });
    return updated;
  }

  async removeMember(t: Tenant, userId: string) {
    const self = userId === t.userId;
    if (!self && !['OWNER', 'ADMIN'].includes(t.role)) throw new ForbiddenException({ error: 'forbidden', message: 'Requires admin role' });
    const m = await this.prisma.membership.findUnique({ where: { organizationId_userId: { organizationId: t.organizationId, userId } } });
    if (!m) throw new NotFoundException({ error: 'not_found', message: 'Member not found' });
    if (m.role === 'OWNER' && !self && t.role !== 'OWNER') throw new ForbiddenException({ error: 'forbidden', message: 'Only owners can remove owners' });
    if (m.role === 'OWNER' && (await this.ownerCount(t.organizationId)) <= 1) throw new BadRequestException({ error: 'last_owner', message: 'An organization needs at least one owner' });
    await this.prisma.membership.delete({ where: { id: m.id } });
    await this.audit.record({ organizationId: t.organizationId, actorId: t.userId, action: self ? 'member.left' : 'member.removed', targetType: 'user', targetId: userId });
  }

  async invite(t: Tenant, email: string, role: Role) {
    if ((role === 'OWNER' || role === 'ADMIN') && t.role !== 'OWNER') throw new ForbiddenException({ error: 'forbidden', message: 'Only owners can invite admins or owners' });
    const [members, pending] = await Promise.all([
      this.prisma.membership.count({ where: { organizationId: t.organizationId } }),
      this.prisma.invitation.count({ where: { organizationId: t.organizationId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }),
    ]);
    if (members + pending >= PLANS[t.plan].seats) throw new ForbiddenException({ error: 'plan_limit', limit: 'seats', message: `The ${PLANS[t.plan].label} plan allows ${PLANS[t.plan].seats} seats` });
    const existing = await this.prisma.membership.findFirst({ where: { organizationId: t.organizationId, user: { email } } });
    if (existing) throw new ConflictException({ error: 'already_member', message: 'This person is already a member' });
    const token = randomToken('rpinv_');
    const inv = await this.prisma.invitation.create({ data: { organizationId: t.organizationId, email, role, tokenHash: sha256(token), invitedById: t.userId ?? 'api', expiresAt: new Date(Date.now() + INVITE_TTL_MS) }, select: { id: true, email: true, role: true, expiresAt: true, createdAt: true } });
    this.mail.send(email, `You are invited to ${t.slug} on ReviewPilot`, `Accept: ${this.config.WEB_ORIGIN}/invite?token=${token}`);
    await this.audit.record({ organizationId: t.organizationId, actorId: t.userId, action: 'invitation.created', targetType: 'invitation', targetId: inv.id, metadata: { email, role } });
    return inv;
  }

  invitations(t: Tenant) {
    return this.prisma.invitation.findMany({ where: { organizationId: t.organizationId, acceptedAt: null, revokedAt: null }, select: { id: true, email: true, role: true, expiresAt: true, createdAt: true }, orderBy: { createdAt: 'desc' } });
  }

  async revokeInvitation(t: Tenant, id: string) {
    const r = await this.prisma.invitation.updateMany({ where: { id, organizationId: t.organizationId, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    if (r.count === 0) throw new NotFoundException({ error: 'not_found', message: 'Invitation not found' });
    await this.audit.record({ organizationId: t.organizationId, actorId: t.userId, action: 'invitation.revoked', targetType: 'invitation', targetId: id });
  }

  async accept(user: { id: string; email: string }, token: string) {
    const inv = await this.prisma.invitation.findUnique({ where: { tokenHash: sha256(token) }, include: { organization: { select: { slug: true } } } });
    if (!inv || inv.revokedAt || inv.acceptedAt || inv.expiresAt.getTime() < Date.now()) throw new BadRequestException({ error: 'invalid_invitation', message: 'This invitation is invalid or has expired' });
    if (inv.email !== user.email) throw new ForbiddenException({ error: 'wrong_account', message: 'This invitation was sent to a different email address' });
    await this.prisma.$transaction([
      this.prisma.invitation.update({ where: { id: inv.id, acceptedAt: null }, data: { acceptedAt: new Date() } }),
      this.prisma.membership.upsert({ where: { organizationId_userId: { organizationId: inv.organizationId, userId: user.id } }, update: {}, create: { organizationId: inv.organizationId, userId: user.id, role: inv.role } }),
    ]);
    await this.audit.record({ organizationId: inv.organizationId, actorId: user.id, action: 'invitation.accepted', targetType: 'invitation', targetId: inv.id });
    return { organization: inv.organization.slug, role: inv.role };
  }

  projects(t: Tenant) {
    return this.prisma.project.findMany({ where: { organizationId: t.organizationId }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, repoUrl: true, createdAt: true, _count: { select: { reviews: true } } } });
  }

  async createProject(t: Tenant, data: { name: string; repoUrl?: string }) {
    const count = await this.prisma.project.count({ where: { organizationId: t.organizationId } });
    if (count >= PLANS[t.plan].projects) throw new ForbiddenException({ error: 'plan_limit', limit: 'projects', message: `The ${PLANS[t.plan].label} plan allows ${PLANS[t.plan].projects} projects` });
    try {
      const p = await this.prisma.project.create({ data: { ...data, organizationId: t.organizationId } });
      await this.audit.record({ organizationId: t.organizationId, actorId: t.userId, action: 'project.created', targetType: 'project', targetId: p.id, metadata: { name: data.name } });
      return p;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException({ error: 'project_exists', message: 'A project with this name already exists' });
      throw e;
    }
  }

  async deleteProject(t: Tenant, id: string) {
    const r = await this.prisma.project.deleteMany({ where: { id, organizationId: t.organizationId } });
    if (r.count === 0) throw new NotFoundException({ error: 'not_found', message: 'Project not found' });
    await this.audit.record({ organizationId: t.organizationId, actorId: t.userId, action: 'project.deleted', targetType: 'project', targetId: id });
  }

  auditLog(t: Tenant, limit: number) {
    return this.prisma.auditEvent.findMany({ where: { organizationId: t.organizationId }, orderBy: { createdAt: 'desc' }, take: limit });
  }
}
