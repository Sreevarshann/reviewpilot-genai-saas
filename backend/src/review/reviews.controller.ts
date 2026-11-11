import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { Redis } from 'ioredis';
import { z } from 'zod';
import { CONFIG, type AppConfig } from '../config.js';
import { CurrentTenant, RequireRole, type Tenant } from '../tenancy/tenancy.js';
import { TenantGuard } from '../tenancy/tenant.guard.js';
import { channel, TERMINAL } from './events.service.js';
import { assertIdempotencyKey, ReviewsService } from './reviews.service.js';

const SubmitSchema = z.object({ projectId: z.string().min(1).max(40), title: z.string().trim().min(1).max(200), diff: z.string().min(10).max(5_000_000) });
const ListQuery = z.object({ projectId: z.string().max(40).optional(), status: z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED']).optional(), take: z.coerce.number().int().min(1).max(200).default(50) });
const FindingQuery = z.object({ severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']).optional(), state: z.enum(['OPEN', 'ACCEPTED', 'DISMISSED', 'FALSE_POSITIVE']).optional(), confidence: z.enum(['DETERMINISTIC', 'MODEL']).optional() });

@Controller('orgs/:org/reviews')
@UseGuards(TenantGuard)
export class ReviewsController {
  constructor(
    private readonly reviews: ReviewsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Post()
  @RequireRole('REVIEWER')
  @HttpCode(202)
  async submit(@CurrentTenant() t: Tenant, @Body({ schema: SubmitSchema }) body: z.infer<typeof SubmitSchema>, @Headers('idempotency-key') key: string | undefined, @Res({ passthrough: true }) res: Response) {
    assertIdempotencyKey(key); // reject before the service runs (defence in depth: the service checks again)
    const { review, replayed } = await this.reviews.submit(t, body, key);
    if (replayed) res.setHeader('Idempotent-Replayed', 'true');
    return review;
  }

  @Get()
  list(@CurrentTenant() t: Tenant, @Query({ schema: ListQuery }) q: z.infer<typeof ListQuery>) {
    return this.reviews.list(t, q);
  }

  @Get(':id')
  get(@CurrentTenant() t: Tenant, @Param('id') id: string) {
    return this.reviews.get(t, id);
  }

  @Get(':id/diff')
  async rawDiff(@CurrentTenant() t: Tenant, @Param('id') id: string, @Res() res: Response) {
    res.type('text/plain').send(await this.reviews.diff(t, id));
  }

  @Get(':id/findings')
  findings(@CurrentTenant() t: Tenant, @Param('id') id: string, @Query({ schema: FindingQuery }) q: z.infer<typeof FindingQuery>) {
    return this.reviews.findings(t, id, q);
  }

  @Post(':id/rerun')
  @RequireRole('REVIEWER')
  @HttpCode(202)
  async rerun(@CurrentTenant() t: Tenant, @Param('id') id: string) {
    return (await this.reviews.rerun(t, id)).review;
  }

  /**
   * Authenticated SSE stream of real pipeline events: replays stored events (so a reload never
   * misses progress), then follows the Redis channel until the review completes or fails.
   */
  @Get(':id/events')
  async stream(@CurrentTenant() t: Tenant, @Param('id') id: string, @Headers('last-event-id') lastId: string | undefined, @Res() res: Response): Promise<void> {
    let last = Number(lastId ?? 0) || 0;
    const past = await this.reviews.events(t, id, last);
    res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    const send = (e: { seq: number; stage: string; status: string; detail: unknown }) => {
      if (e.seq <= last) return;
      last = e.seq;
      res.write(`id: ${e.seq}\nevent: progress\ndata: ${JSON.stringify(e)}\n\n`);
    };
    for (const e of past) send(e);
    if (past.some((e) => TERMINAL.has(e.stage)) || TERMINAL.has(String(await this.reviews.status(t, id)).toLowerCase())) {
      res.end();
      return;
    }
    const sub = new Redis(this.config.REDIS_URL, { maxRetriesPerRequest: 2 });
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
    const close = () => {
      clearInterval(ping);
      sub.disconnect();
      res.end();
    };
    res.on('close', close);
    sub.on('message', (_c, raw) => {
      const e = JSON.parse(raw) as { seq: number; stage: string; status: string; detail: unknown };
      send(e);
      if (TERMINAL.has(e.stage)) close();
    });
    await sub.subscribe(channel(id));
    // close the race between replay and subscribe
    for (const e of await this.reviews.events(t, id, last)) {
      send(e);
      if (TERMINAL.has(e.stage)) close();
    }
  }
}
