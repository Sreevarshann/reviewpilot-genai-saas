import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MailService } from '../mail/mail.service.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, PasswordService, SessionService, MailService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [SessionService, MailService, PasswordService],
})
export class AuthModule {}
