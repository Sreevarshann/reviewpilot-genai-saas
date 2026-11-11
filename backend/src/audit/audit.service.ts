import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(e: { organizationId: string; actorId?: string | null; action: string; targetType?: string; targetId?: string; metadata?: Prisma.InputJsonValue; ip?: string }): Promise<void> {
    await this.prisma.auditEvent.create({ data: { ...e, metadata: e.metadata ?? {} } });
  }
}
