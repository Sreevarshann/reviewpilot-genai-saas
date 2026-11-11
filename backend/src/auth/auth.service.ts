import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config.js';
import { randomToken, sha256 } from '../common/crypto.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { LoginInput, RegisterInput } from './auth.schemas.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';

const RESET_TTL_MS = 30 * 60_000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly mail: MailService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async register(input: RegisterInput): Promise<{ id: string }> {
    const passwordHash = await this.passwords.hash(input.password);
    try {
      return await this.prisma.user.create({ data: { email: input.email, name: input.name, passwordHash }, select: { id: true } });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException({ error: 'email_taken', message: 'An account with this email already exists' });
      throw e;
    }
  }

  async login(input: LoginInput): Promise<{ id: string }> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const ok = await this.passwords.verify(input.password, user?.passwordHash);
    if (!user || !ok) throw new UnauthorizedException({ error: 'invalid_credentials', message: 'Email or password is incorrect' });
    return { id: user.id };
  }

  /** Always succeeds from the caller's view, so it cannot be used to discover accounts. */
  async requestReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return;
    const token = randomToken();
    await this.prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) } });
    this.mail.send(email, 'Reset your ReviewPilot password', `Reset link (valid 30 minutes): ${this.config.WEB_ORIGIN}/reset-password?token=${token}`);
  }

  async confirmReset(token: string, password: string): Promise<void> {
    const row = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) throw new UnauthorizedException({ error: 'invalid_token', message: 'This reset link is invalid or has expired' });
    const passwordHash = await this.passwords.hash(password);
    await this.prisma.$transaction([
      // single use: conditional update fails if a concurrent request used it first
      this.prisma.passwordResetToken.update({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.user.update({ where: { id: row.userId }, data: { passwordHash } }),
      this.prisma.session.deleteMany({ where: { userId: row.userId } }),
    ]);
  }

  async me(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, name: true, createdAt: true, memberships: { select: { role: true, organization: { select: { id: true, name: true, slug: true, plan: true } } } } },
    });
  }

  startSession(userId: string, meta: { userAgent?: string; ip?: string }): Promise<string> {
    return this.sessions.create(userId, meta);
  }
}
