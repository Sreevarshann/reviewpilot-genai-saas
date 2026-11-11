import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { LlmFactory } from '../llm/llm.js';
import { ReviewEventsService } from './events.service.js';
import { ReviewOrchestrator } from './orchestrator.js';
import { ReviewProcessor } from './review.processor.js';
import { ReviewsController } from './reviews.controller.js';
import { REVIEW_QUEUE, ReviewsService } from './reviews.service.js';

@Module({
  imports: [BullModule.registerQueue({ name: REVIEW_QUEUE })],
  controllers: [ReviewsController],
  providers: [ReviewsService, ReviewOrchestrator, ReviewEventsService, ReviewProcessor, LlmFactory],
  exports: [ReviewsService, ReviewOrchestrator],
})
export class ReviewModule {}
