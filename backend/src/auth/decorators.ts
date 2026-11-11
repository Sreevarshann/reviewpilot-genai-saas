import { createParamDecorator, type ExecutionContext, SetMetadata, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { SessionUser } from './session.service.js';

export const IS_PUBLIC = 'rp:public';
/** Route does not require a signed-in user. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export type AuthedRequest = Request & { user?: SessionUser; apiToken?: { id: string; organizationId: string } };

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): SessionUser => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.user) throw new UnauthorizedException({ error: 'user_session_required', message: 'This endpoint requires a signed-in user' });
  return req.user;
});
