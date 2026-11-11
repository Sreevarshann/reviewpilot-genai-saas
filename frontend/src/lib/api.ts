import type { ApiToken, AuditEvent, Finding, FindingState, Invitation, Mail, Me, Member, Org, Plan, Project, Review, ReviewEvent, Role } from "./types";

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly detail?: unknown) {
    super(message);
  }
}

/** All calls go through the same-origin /api proxy with the HttpOnly session cookie. */
async function req<T>(path: string, init: RequestInit & { idempotencyKey?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { "X-Requested-With": "reviewpilot" };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;
  const res = await fetch(`/api${path}`, { ...init, credentials: "same-origin", headers: { ...headers, ...(init.headers as Record<string, string>) } });
  if (!res.ok) {
    let code = "http_error";
    let message = res.statusText || `Request failed (${res.status})`;
    let detail: unknown;
    try {
      const b = await res.json();
      code = b.error ?? code;
      detail = b.limit ?? b.details;
      message = Array.isArray(b.message) ? b.message.join("; ") : (b.message ?? message);
    } catch {}
    throw new ApiError(res.status, code, message, detail);
  }
  if (res.status === 204) return undefined as T;
  const type = res.headers.get("content-type") ?? "";
  return (type.includes("json") ? await res.json() : await res.text()) as T;
}

const json = (body: unknown) => JSON.stringify(body);
const o = (org: string) => `/orgs/${encodeURIComponent(org)}`;

export interface Usage {
  plan: Plan; planLabel: string; period: { start: string };
  reviews: { used: number; limit: number }; llmTokens: { used: number; limit: number }; processing: { totalMs: number; avgMs: number };
  seats: { used: number; limit: number }; projects: { used: number; limit: number }; maxDiffBytes: number;
  byModel: { provider: string | null; model: string | null; tokens: number; reviews: number }[]; daily: { day: string; reviews: number; tokens: number }[];
}
export interface PlanInfo { id: Plan; label: string; reviewsPerMonth: number; projects: number; seats: number; maxDiffBytes: number; llmTokensPerMonth: number }
export interface Analytics {
  range: { from: string; to: string; days: number; projectId: string | null };
  reviews: { completed: number; failed: number; pending: number; total: number; failureRate: number | null };
  reviewsOverTime: { day: string; completed: number; failed: number; pending: number }[];
  latencyMs: { samples: number; p50: number | null; p90: number | null; avg: number | null; max: number | null };
  findingsByCategory: { category: string; confidence: string; count: number }[];
  findingsBySeverity: { severity: string; count: number }[];
  triage: Record<"all" | "deterministic" | "model", { open: number; accepted: number; dismissed: number; falsePositive: number; triaged: number; acceptanceRate: number | null }> & { note: string };
  models: { provider: string | null; model: string | null; reviews: number; tokensIn: number; tokensOut: number; avgMs: number | null }[];
  topRules: { source: string; count: number; accepted: number; rejected: number }[];
  projects: { id: string; name: string; reviews: number; findings: number }[];
}
export interface Compare { base: { id: string; version: number }; head: { id: string; version: number }; introduced: Finding[]; resolved: Finding[]; persisting: Finding[] }
export interface Health { status: string; database: boolean; redis: boolean; llmProvider: string; model: string }

export const api = {
  health: () => req<Health>("/health"),
  me: () => req<Me>("/auth/me"),
  register: (b: { email: string; name: string; password: string; organizationName?: string }) => req<Me>("/auth/register", { method: "POST", body: json(b) }),
  login: (b: { email: string; password: string }) => req<Me>("/auth/login", { method: "POST", body: json(b) }),
  logout: () => req<void>("/auth/logout", { method: "POST" }),
  logoutAll: () => req<void>("/auth/logout-all", { method: "POST" }),
  resetRequest: (email: string) => req<{ ok: true }>("/auth/password-reset/request", { method: "POST", body: json({ email }) }),
  resetConfirm: (token: string, password: string) => req<{ ok: true }>("/auth/password-reset/confirm", { method: "POST", body: json({ token, password }) }),
  outbox: (email: string) => req<Mail[]>(`/dev/outbox?email=${encodeURIComponent(email)}`),

  orgs: () => req<{ role: Role; organization: { id: string; name: string; slug: string; plan: Plan } }[]>("/orgs"),
  createOrg: (name: string) => req<{ slug: string }>("/orgs", { method: "POST", body: json({ name }) }),
  acceptInvite: (token: string) => req<{ organization: string; role: Role }>("/invitations/accept", { method: "POST", body: json({ token }) }),
  org: (org: string) => req<Org>(o(org)),
  updateOrg: (org: string, b: { name?: string; retentionDays?: number }) => req<Org>(o(org), { method: "PATCH", body: json(b) }),
  members: (org: string) => req<Member[]>(`${o(org)}/members`),
  setRole: (org: string, userId: string, role: Role) => req<Member>(`${o(org)}/members/${userId}`, { method: "PATCH", body: json({ role }) }),
  removeMember: (org: string, userId: string) => req<void>(`${o(org)}/members/${userId}`, { method: "DELETE" }),
  invitations: (org: string) => req<Invitation[]>(`${o(org)}/invitations`),
  invite: (org: string, email: string, role: Role) => req<Invitation>(`${o(org)}/invitations`, { method: "POST", body: json({ email, role }) }),
  revokeInvite: (org: string, id: string) => req<void>(`${o(org)}/invitations/${id}`, { method: "DELETE" }),
  projects: (org: string) => req<Project[]>(`${o(org)}/projects`),
  createProject: (org: string, name: string, repoUrl?: string) => req<Project>(`${o(org)}/projects`, { method: "POST", body: json({ name, ...(repoUrl ? { repoUrl } : {}) }) }),
  deleteProject: (org: string, id: string) => req<void>(`${o(org)}/projects/${id}`, { method: "DELETE" }),
  audit: (org: string) => req<AuditEvent[]>(`${o(org)}/audit?limit=200`),

  reviews: (org: string) => req<Review[]>(`${o(org)}/reviews`),
  review: (org: string, id: string) => req<Review>(`${o(org)}/reviews/${id}`),
  findings: (org: string, id: string) => req<Finding[]>(`${o(org)}/reviews/${id}/findings`),
  submitReview: (org: string, b: { projectId: string; title: string; diff: string }, idempotencyKey: string) => req<Review>(`${o(org)}/reviews`, { method: "POST", body: json(b), idempotencyKey }),
  rerun: (org: string, id: string) => req<Review>(`${o(org)}/reviews/${id}/rerun`, { method: "POST" }),
  compare: (org: string, id: string, other: string) => req<Compare>(`${o(org)}/reviews/${id}/compare/${other}`),
  exportUrl: (org: string, id: string, format: "json" | "csv" | "md" | "sarif") => `/api${o(org)}/reviews/${id}/export?format=${format}`,
  setFindingState: (org: string, id: string, state: FindingState, note?: string) => req<Finding>(`${o(org)}/findings/${id}`, { method: "PATCH", body: json({ state, ...(note ? { note } : {}) }) }),
  comment: (org: string, id: string, body: string) => req<{ id: string }>(`${o(org)}/findings/${id}/comments`, { method: "POST", body: json({ body }) }),

  usage: (org: string) => req<Usage>(`${o(org)}/usage`),
  plans: () => req<{ note: string; plans: PlanInfo[] }>("/plans"),
  changePlan: (org: string, plan: Plan) => req<{ plan: Plan; provider: "mock"; charged: false; note: string }>(`${o(org)}/billing/plan`, { method: "POST", body: json({ plan }) }),
  analytics: (org: string, days: number, projectId?: string) => req<Analytics>(`${o(org)}/analytics?days=${days}${projectId ? `&projectId=${projectId}` : ""}`),
  tokens: (org: string) => req<ApiToken[]>(`${o(org)}/api-tokens`),
  createToken: (org: string, name: string) => req<ApiToken & { token: string; note: string }>(`${o(org)}/api-tokens`, { method: "POST", body: json({ name }) }),
  revokeToken: (org: string, id: string) => req<void>(`${o(org)}/api-tokens/${id}`, { method: "DELETE" }),
  runRetention: (org: string) => req<{ deletedReviews: number }>(`${o(org)}/retention/run`, { method: "POST" }),
};

export const TERMINAL_STAGES = new Set(["completed", "failed"]);

/**
 * Follows the authenticated SSE stream: stored events are replayed first, then live ones.
 * The server ends the stream after a terminal stage; closing here stops EventSource from
 * reconnecting.
 */
export function followReview(org: string, id: string, onEvent: (e: ReviewEvent) => void, onEnd: () => void): () => void {
  const es = new EventSource(`/api${o(org)}/reviews/${id}/events`, { withCredentials: true });
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    es.close();
    onEnd();
  };
  es.addEventListener("progress", (m) => {
    const e = JSON.parse((m as MessageEvent).data) as ReviewEvent;
    onEvent(e);
    if (TERMINAL_STAGES.has(e.stage)) end();
  });
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) end();
  };
  return () => {
    ended = true;
    es.close();
  };
}
