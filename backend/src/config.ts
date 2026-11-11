import { z } from 'zod';

/** All configuration comes from the environment and is validated at startup. */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(8113),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://127.0.0.1:56503'),
  WEB_ORIGIN: z.string().url().default('http://localhost:3103'),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  SESSION_IDLE_HOURS: z.coerce.number().positive().default(72),
  SESSION_ABSOLUTE_DAYS: z.coerce.number().positive().default(14),
  LLM_PROVIDER: z.enum(['ollama', 'openai_compatible', 'fixture']).default('ollama'),
  LLM_BASE_URL: z.string().url().default('http://127.0.0.1:11434'),
  LLM_MODEL: z.string().default('qwen3:4b-instruct'),
  LLM_API_KEY: z.string().optional(),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  REVIEW_INLINE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  WEBHOOK_SECRET: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(16).optional()),
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return parsed.data;
}

export const CONFIG = Symbol('CONFIG');
