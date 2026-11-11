import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentTenant, RequireRole, type Tenant } from '../tenancy/tenancy.js';
import { TenantGuard } from '../tenancy/tenant.guard.js';
import { FindingsService } from './findings.service.js';

const StateSchema = z.object({ state: z.enum(['OPEN', 'ACCEPTED', 'DISMISSED', 'FALSE_POSITIVE']), note: z.string().trim().min(1).max(2000).optional() });
const CommentSchema = z.object({ body: z.string().trim().min(1).max(4000) });
const ExportQuery = z.object({ format: z.enum(['json', 'csv', 'md', 'sarif']).default('json') });

@Controller('orgs/:org')
@UseGuards(TenantGuard)
export class FindingsController {
  constructor(private readonly findings: FindingsService) {}

  @Patch('findings/:id')
  @RequireRole('REVIEWER')
  setState(@CurrentTenant() t: Tenant, @Param('id') id: string, @Body({ schema: StateSchema }) body: z.infer<typeof StateSchema>) {
    return this.findings.setState(t, id, body.state, body.note);
  }

  @Post('findings/:id/comments')
  @RequireRole('REVIEWER')
  comment(@CurrentTenant() t: Tenant, @Param('id') id: string, @Body({ schema: CommentSchema }) body: z.infer<typeof CommentSchema>) {
    return this.findings.comment(t, id, body.body);
  }

  @Get('reviews/:id/compare/:otherId')
  compare(@CurrentTenant() t: Tenant, @Param('id') id: string, @Param('otherId') otherId: string) {
    return this.findings.compare(t, id, otherId);
  }

  @Get('reviews/:id/export')
  async export(@CurrentTenant() t: Tenant, @Param('id') id: string, @Query({ schema: ExportQuery }) q: z.infer<typeof ExportQuery>, @Res() res: Response) {
    const out = await this.findings.export(t, id, q.format);
    res.type(out.type).set('Content-Disposition', `attachment; filename="reviewpilot-${id.slice(0, 10)}.${out.ext}"`).set('X-Content-Type-Options', 'nosniff').send(out.body);
  }
}
