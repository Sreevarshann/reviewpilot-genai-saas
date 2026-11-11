import { Body, Controller, Headers, HttpCode, Inject, Post, Req, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { Request } from 'express';
import { z } from 'zod';
import { Public } from '../auth/decorators.js';
import { safeEqual } from '../common/crypto.js';
import { CONFIG, type AppConfig } from '../config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReviewsService } from '../review/reviews.service.js';
import { ApiTokensService } from './api-tokens.service.js';

const TOLERANCE_S = 300;
const Payload = z.object({ deliveryId: z.string().regex(/^[\w-]{8,64}$/), project: z.string().min(1).max(80), title: z.string().min(1).max(200), diff: z.string().min(10).max(5_000_000) });

export function signWebhook(secret: string, timestamp: number, body: string): string {
  return `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

/**
 * Signed intake for CI systems: requires BOTH an org API token (who) and an HMAC-SHA256
 * signature over "<timestamp>.<raw body>" with the shared webhook secret (integrity), a
 * timestamp within 5 minutes (replay window) and a unique delivery id (replay protection).
 * Read-only: it creates a review; it never writes back to any repository.
 */
@Controller('webhooks')
export class WebhookController {
  constructor(
    private readonly tokens: ApiTokensService,
    private readonly reviews: ReviewsService,
    private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('reviews')
  @HttpCode(202)
  async intake(@Req() req: Request & { rawBody?: Buffer }, @Headers('x-reviewpilot-signature') sig: string | undefined, @Headers('authorization') auth: string | undefined, @Body({ schema: Payload }) body: z.infer<typeof Payload>) {
    const secret = this.config.WEBHOOK_SECRET;
    if (!secret) throw new ServiceUnavailableException({ error: 'webhooks_disabled', message: 'Webhook intake is not configured' });
    const m = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(sig ?? '');
    const raw = req.rawBody?.toString('utf8') ?? '';
    if (!m || !raw) throw new UnauthorizedException({ error: 'bad_signature', message: 'Missing or malformed signature' });
    if (Math.abs(Date.now() / 1000 - Number(m[1])) > TOLERANCE_S) throw new UnauthorizedException({ error: 'stale_signature', message: 'Signature timestamp outside the allowed window' });
    if (!safeEqual(signWebhook(secret, Number(m[1]), raw), `t=${m[1]},v1=${m[2]}`)) throw new UnauthorizedException({ error: 'bad_signature', message: 'Signature does not match' });
    const token = await this.tokens.authenticate((auth ?? '').replace(/^Bearer /, ''));
    if (!token) throw new UnauthorizedException({ error: 'bad_token', message: 'Valid API token required' });
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: token.organizationId }, select: { id: true, slug: true, plan: true } });
    const project = await this.prisma.project.findFirst({ where: { organizationId: org.id, name: body.project } });
    if (!project) throw new UnauthorizedException({ error: 'unknown_project', message: 'Project not found in the token organization' });
    const { review, replayed } = await this.reviews.submit({ organizationId: org.id, slug: org.slug, plan: org.plan, role: 'REVIEWER', userId: null, via: 'api_token' }, { projectId: project.id, title: body.title, diff: body.diff }, `wh_${body.deliveryId}`);
    return { reviewId: review.id, status: review.status, replayed };
  }
}
