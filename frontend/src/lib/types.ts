export type Role = "OWNER" | "ADMIN" | "REVIEWER" | "VIEWER";
export type Plan = "FREE" | "TEAM" | "BUSINESS";
export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
export type Category = "BUG" | "SECURITY" | "ERROR_HANDLING" | "PERFORMANCE" | "MAINTAINABILITY" | "TESTING" | "DOCUMENTATION";
export type FindingState = "OPEN" | "ACCEPTED" | "DISMISSED" | "FALSE_POSITIVE";
export type ReviewStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";

export interface OrgRef { id: string; name: string; slug: string; plan: Plan }
export interface Me { id: string; email: string; name: string; createdAt: string; memberships: { role: Role; organization: OrgRef }[] }
export interface Limits { label: string; reviewsPerMonth: number; projects: number; seats: number; maxDiffBytes: number; llmTokensPerMonth: number }
export interface Org extends OrgRef { retentionDays: number; createdAt: string; role: Role; limits: Limits; _count: { memberships: number; projects: number } }
export interface Member { role: Role; createdAt: string; user: { id: string; email: string; name: string } }
export interface Invitation { id: string; email: string; role: Role; expiresAt: string; createdAt: string }
export interface Project { id: string; name: string; repoUrl: string | null; createdAt: string; _count?: { reviews: number } }

export interface DiffLine { type: "add" | "del" | "ctx"; text: string; oldLine: number | null; newLine: number | null }
export interface DiffHunk { oldStart: number; oldLines: number; newStart: number; newLines: number; header: string; lines: DiffLine[] }
export interface ReviewFile { id: string; path: string; oldPath: string | null; language: string; status: string; additions: number; deletions: number; hunks: DiffHunk[] }
export interface ReviewStats {
  files?: number; additions?: number; deletions?: number; bySeverity?: Partial<Record<Severity, number>>;
  deterministic?: number; modelAccepted?: number; modelRejected?: number; modelError?: string | null; contextTruncated?: boolean;
}
export interface Review {
  id: string; title: string; status: ReviewStatus; version: number; parentReviewId: string | null; projectId: string; project: { name: string }; authorId: string;
  stats: ReviewStats; provider: string | null; model: string | null; tokensIn: number; tokensOut: number; durationMs: number | null; error: string | null;
  createdAt: string; startedAt: string | null; completedAt: string | null; files?: ReviewFile[];
}
export interface Comment { id: string; body: string; createdAt: string; authorId: string }
export interface Finding {
  id: string; reviewId: string; fileId: string | null; path: string; lineStart: number; lineEnd: number; category: Category; severity: Severity; title: string;
  description: string; evidence: string; suggestedFix: string | null; confidence: "DETERMINISTIC" | "MODEL"; source: string; state: FindingState;
  stateChangedAt: string | null; fingerprint: string; comments: Comment[];
}
export interface ReviewEvent { id: string; seq: number; stage: string; status: string; detail: Record<string, unknown>; createdAt: string }
export interface ApiToken { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }
export interface AuditEvent { id: string; action: string; targetType: string | null; targetId: string | null; metadata: Record<string, unknown>; createdAt: string; actor?: { name: string; email: string } | null; actorId?: string | null }
export interface Mail { to: string; subject: string; text: string; sentAt: string }
