import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ReviewModule } from '../review/review.module.js';
import { AdminController } from './admin.controller.js';
import { ApiTokensService } from './api-tokens.service.js';
import { MAINTENANCE_QUEUE, MaintenanceProcessor, RetentionService } from './retention.service.js';
import { WebhookController } from './webhook.controller.js';

@Global()
@Module({
  imports: [BullModule.registerQueue({ name: MAINTENANCE_QUEUE }), ReviewModule],
  controllers: [AdminController, WebhookController],
  providers: [ApiTokensService, RetentionService, MaintenanceProcessor],
  exports: [ApiTokensService],
})
export class AdminModule {}
