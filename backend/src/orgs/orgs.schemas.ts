import { z } from 'zod';

export const RoleSchema = z.enum(['OWNER', 'ADMIN', 'REVIEWER', 'VIEWER']);
export const CreateOrgSchema = z.object({ name: z.string().trim().min(2).max(80) });
export const UpdateOrgSchema = z.object({ name: z.string().trim().min(2).max(80).optional(), retentionDays: z.number().int().min(7).max(3650).optional() });
export const InviteSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254), role: RoleSchema.default('REVIEWER') });
export const AcceptInviteSchema = z.object({ token: z.string().min(20).max(200) });
export const ChangeRoleSchema = z.object({ role: RoleSchema });
export const ProjectSchema = z.object({ name: z.string().trim().min(1).max(80), repoUrl: z.string().trim().url().max(500).optional() });
