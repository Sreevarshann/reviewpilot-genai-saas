import { Controller, Get, Inject, NotFoundException, Query } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../auth/decorators.js';
import { CONFIG, type AppConfig } from '../config.js';
import { MailService } from './mail.service.js';

const Q = z.object({ email: z.string().trim().toLowerCase().email().max(254) });

/**
 * Local-demo mailbox for the development mail transport (no email is ever sent). Disabled
 * unless DEV_MAIL_OUTBOX=true, and configuration refuses that flag in production, because the
 * messages contain live invitation and password-reset links.
 */
@Controller('dev/outbox')
export class DevOutboxController {
  constructor(
    private readonly mail: MailService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Get()
  list(@Query({ schema: Q }) q: z.infer<typeof Q>) {
    if (!this.config.DEV_MAIL_OUTBOX) throw new NotFoundException();
    return this.mail.outbox.filter((m) => m.to === q.email).slice(-10).reverse();
  }
}
