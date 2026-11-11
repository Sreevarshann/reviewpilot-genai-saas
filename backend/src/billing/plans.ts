import type { Plan } from '../../generated/prisma/enums.js';

/**
 * Local demo plan tiers. These are NOT purchasable subscriptions: no payment provider is
 * configured, and plan changes go through a mock billing provider that never charges.
 */
export interface PlanLimits {
  label: string;
  reviewsPerMonth: number;
  projects: number;
  seats: number;
  maxDiffBytes: number;
  llmTokensPerMonth: number;
}

export const PLANS: Record<Plan, PlanLimits> = {
  FREE: { label: 'Free', reviewsPerMonth: 25, projects: 2, seats: 3, maxDiffBytes: 200_000, llmTokensPerMonth: 200_000 },
  TEAM: { label: 'Team', reviewsPerMonth: 500, projects: 20, seats: 25, maxDiffBytes: 1_000_000, llmTokensPerMonth: 5_000_000 },
  BUSINESS: { label: 'Business', reviewsPerMonth: 5_000, projects: 200, seats: 250, maxDiffBytes: 4_000_000, llmTokensPerMonth: 50_000_000 },
};
