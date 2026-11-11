# Multi-tenancy

**Model.** Users belong to organizations through `Membership(role)`. Every tenant-owned row
(`Project`, `Review`, `ReviewFile`, `Finding`, `FindingComment`, `ReviewEvent`, `UsageRecord`,
`AuditEvent`, `ApiToken`, `Invitation`) stores `organizationId` and every query filters by it.

**Enforcement.** All organization routes live under `/api/orgs/:org/...` and use `TenantGuard`:

- It resolves `:org` (slug) and the caller's membership. Non-members get **404**, not 403, so
  the existence of other organizations is not disclosed.
- `@RequireRole('REVIEWER' | 'ADMIN' | 'OWNER')` uses the hierarchy VIEWER < REVIEWER < ADMIN < OWNER.
- API tokens resolve to their issuing organization only and act as `REVIEWER`.
- Services receive a `Tenant` object and use `findFirst({ where: { id, organizationId } })` or
  `updateMany({ where: { id, organizationId } })`. Cross-tenant ids therefore behave as "not found".

**Role rules.** Only owners can grant ADMIN or OWNER, change the plan, or invite admins; the last
owner cannot leave or be demoted; invitations are email-bound, single-use and expire after 7 days.

**Tests.** `test/tenancy.e2e-spec.ts` exercises every org route type with a second organization's
session. `admin`, `analytics`, `findings` and `reviews` specs repeat the check for their own routes
(token isolation, cross-tenant revoke, analytics leakage, compare/export by foreign id). The
Playwright journey ends with a member of another organization receiving "Organization not found"
for Acme's pages and 404 from the API.
