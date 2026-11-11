import { Injectable, Logger } from '@nestjs/common';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  sentAt: Date;
}

/**
 * Development mail transport: no email is sent. Messages are logged (without tokens in
 * production mode) and kept in a small in-memory outbox that tests and the local demo read.
 * Replace with an SMTP/API transport for deployment.
 */
@Injectable()
export class MailService {
  private readonly log = new Logger('Mail');
  readonly outbox: Mail[] = [];

  send(to: string, subject: string, text: string): void {
    this.outbox.push({ to, subject, text, sentAt: new Date() });
    if (this.outbox.length > 50) this.outbox.shift();
    this.log.log(`mail to=${to} subject="${subject}"`);
  }
}
