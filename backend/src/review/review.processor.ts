import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { ReviewOrchestrator } from './orchestrator.js';
import { REVIEW_QUEUE } from './reviews.service.js';

/** BullMQ worker. The orchestrator only runs reviews still QUEUED, so retries/duplicates are safe. */
@Processor(REVIEW_QUEUE, { concurrency: 1 })
export class ReviewProcessor extends WorkerHost {
  constructor(private readonly orchestrator: ReviewOrchestrator) {
    super();
  }

  async process(job: Job<{ reviewId: string }>): Promise<void> {
    await this.orchestrator.run(job.data.reviewId);
  }
}
