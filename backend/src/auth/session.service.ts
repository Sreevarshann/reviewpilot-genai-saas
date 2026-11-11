import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config.js';
import { randomToken, sha256 } from '../common/crypto.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  sessionId: string;
}

const TOUCH_INTERVAL_MS = 5 * 60_000;

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  get cookieName(): string {
    // __Host- prefix requires Secure + Path=/ + no Domain; used whenever cookies are secure.
    return this.config.COOKIE_SECURE ? '__Host-rp_session' : 'rp_session';
  }

  get absoluteMs(): number {
    return this.config.SESSION_ABSOLUTE_DAYS * 86_400_000;
  }

  async create(userId: string, meta: { userAgent?: string; ip?: string }): Promise<string> {
    const token = randomToken();
    await this.prisma.session.create({
      data: { userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + this.absoluteMs), userAgent: meta.userAgent?.slice(0, 300), ip: meta.ip },
    });
    return token;
  }

  async validate(token: string | undefined): Promise<SessionUser | null> {
    if (!token || token.length > 200) return null;
    const s = await this.prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (!s) return null;
    const now = Date.now();
    const idleExpired = now - s.lastSeenAt.getTime() > this.config.SESSION_IDLE_HOURS * 3_600_000;
    if (s.expiresAt.getTime() <= now || idleExpired) {
      await this.prisma.session.delete({ where: { id: s.id } }).catch(() => undefined);
      return null;
    }
    if (now - s.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.session.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } });
    }
    return { id: s.user.id, email: s.user.email, name: s.user.name, sessionId: s.id };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { id: sessionId } });
  }

  async revokeAll(userId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { userId } });
  }
}
