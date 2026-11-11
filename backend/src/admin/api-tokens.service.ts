import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { randomToken, sha256 } from '../common/crypto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Tenant } from '../tenancy/tenancy.js';

export const TOKEN_PREFIX = 'rpk_';

@Injectable()
export class ApiTokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Returns the raw token exactly once; only its SHA-256 hash is stored. */
  async create(t: Tenant, name: string) {
    const token = randomToken(TOKEN_PREFIX);
    const row = await this.prisma.apiToken.create({ data: { organizationId: t.organizationId, name, prefix: token.slice(0, 12), tokenHash: sha256(token), createdById: t.userId ?? 'unknown' }, select: { id: true, name: true, prefix: true, createdAt: true } });
    await this.audit.record({ organizationId: t.organizationId, actorId: t.userId, action: 'api_token.created', targetType: 'api_token', targetId: row.id, metadata: { name } });
    return { ...row, token, note: 'Store this token now; it cannot be shown again.' };
  }

  list(t: Tenant) {
    return this.prisma.apiToken.findMany({ where: { organizationId: t.organizationId }, select: { id: true, name: true, prefix: true, createdAt: true, lastUsedAt: true, revokedAt: true }, orderBy: { createdAt: 'desc' } });
  }

  async revoke(t: Tenant, id: string) {
    const r = await this.prisma.apiToken.updateMany({ where: { id, organizationId: t.organizationId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (r.count === 0) throw new NotFoundException({ error: 'not_found', message: 'Token not found' });
    await this.audit.record({ organizationId: t.organizationId, actorId: t.userId, action: 'api_token.revoked', targetType: 'api_token', targetId: id });
  }

  async authenticate(raw: string): Promise<{ id: string; organizationId: string } | null> {
    if (!raw.startsWith(TOKEN_PREFIX) || raw.length > 120) return null;
    const row = await this.prisma.apiToken.findUnique({ where: { tokenHash: sha256(raw) }, select: { id: true, organizationId: true, revokedAt: true, lastUsedAt: true } });
    if (!row || row.revokedAt) return null;
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) await this.prisma.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
    return { id: row.id, organizationId: row.organizationId };
  }
}
