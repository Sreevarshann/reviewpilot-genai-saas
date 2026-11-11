import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const; // OWASP minimum for argon2id

@Injectable()
export class PasswordService {
  private dummy: Promise<string> = argon2.hash('reviewpilot-dummy-password', OPTIONS);

  hash(password: string): Promise<string> {
    return argon2.hash(password, OPTIONS);
  }

  /** Always performs a hash verification so unknown accounts take as long as known ones. */
  async verify(password: string, hash: string | null | undefined): Promise<boolean> {
    if (!hash) {
      await argon2.verify(await this.dummy, password).catch(() => false);
      return false;
    }
    return argon2.verify(hash, password).catch(() => false);
  }
}
