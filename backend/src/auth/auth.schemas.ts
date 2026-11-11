import { z } from 'zod';

const email = z.string().trim().toLowerCase().email().max(254);
// NIST 800-63B style: length over composition rules.
const password = z.string().min(12, 'Use at least 12 characters').max(256);

export const RegisterSchema = z.object({ email, name: z.string().trim().min(1).max(120), password, organizationName: z.string().trim().min(2).max(80).optional() });
export const LoginSchema = z.object({ email, password: z.string().min(1).max(256) });
export const ResetRequestSchema = z.object({ email });
export const ResetConfirmSchema = z.object({ token: z.string().min(20).max(200), password });

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
