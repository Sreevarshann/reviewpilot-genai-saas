import { type CanActivate, type ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiTokensService } from '../admin/api-tokens.service.js';
import { CONFIG, type AppConfig } from '../config.js';
import { IS_PUBLIC, type AuthedRequest } from './decorators.js';
import { SessionService } from './session.service.js';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Global guard: resolves the session cookie into req.user and enforces an Origin check on
 * state-changing cookie-authenticated requests (CSRF defence in addition to SameSite=Lax).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly apiTokens: ApiTokensService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const cookie = (req.cookies as Record<string, string> | undefined)?.[this.sessions.cookieName];
    if (cookie && UNSAFE.has(req.method)) this.checkOrigin(req);
    if (cookie) req.user = (await this.sessions.validate(cookie)) ?? undefined;
    const bearer = req.headers.authorization;
    // API tokens authenticate machine clients for organization routes only (no cookies, so no CSRF).
    if (!req.user && bearer?.startsWith('Bearer rpk_')) req.apiToken = (await this.apiTokens.authenticate(bearer.slice(7))) ?? undefined;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic || req.user || req.apiToken) return true;
    throw new UnauthorizedException({ error: 'unauthenticated', message: 'Sign in required' });
  }

  private checkOrigin(req: AuthedRequest): void {
    const origin = req.headers.origin;
    const site = req.headers['sec-fetch-site'];
    const allowed = origin ? origin === this.config.WEB_ORIGIN : site === 'same-origin' || site === undefined && req.headers['x-requested-with'] === 'reviewpilot';
    if (!allowed) throw new ForbiddenException({ error: 'bad_origin', message: 'Cross-site request rejected' });
  }
}
