import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config.js';

export interface LlmResult {
  json: unknown;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  completeJson(system: string, user: string, schema: object): Promise<LlmResult>;
}

export class LlmError extends Error {}

function parseJson(text: string): unknown {
  const t = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim().replace(/^```(?:json)?|```$/g, '').trim();
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new LlmError('Model did not return JSON');
  }
}

export class OllamaProvider implements LlmProvider {
  readonly name = 'ollama';
  constructor(readonly model: string, private readonly baseUrl: string, private readonly timeoutMs: number) {}

  async completeJson(system: string, user: string, schema: object): Promise<LlmResult> {
    const t0 = Date.now();
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
        body: JSON.stringify({ model: this.model, stream: false, think: false, format: schema, options: { temperature: 0, seed: 3, num_ctx: 8192, num_predict: 1200 }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      });
    } catch (e) {
      throw new LlmError(`Model request failed: ${(e as Error).name}`);
    }
    if (!res.ok) throw new LlmError(`Model returned HTTP ${res.status}`);
    const d = (await res.json()) as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
    return { json: parseJson(d.message?.content ?? ''), tokensIn: d.prompt_eval_count ?? 0, tokensOut: d.eval_count ?? 0, latencyMs: Date.now() - t0 };
  }
}

export class OpenAICompatibleProvider implements LlmProvider {
  readonly name = 'openai_compatible';
  constructor(readonly model: string, private readonly baseUrl: string, private readonly apiKey: string | undefined, private readonly timeoutMs: number) {}

  async completeJson(system: string, user: string, schema: object): Promise<LlmResult> {
    const t0 = Date.now();
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({ model: this.model, temperature: 0, response_format: { type: 'json_schema', json_schema: { name: 'review', schema } }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    }).catch((e: Error) => {
      throw new LlmError(`Model request failed: ${e.name}`);
    });
    if (!res.ok) throw new LlmError(`Model returned HTTP ${res.status}`);
    const d = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    return { json: parseJson(d.choices?.[0]?.message?.content ?? ''), tokensIn: d.usage?.prompt_tokens ?? 0, tokensOut: d.usage?.completion_tokens ?? 0, latencyMs: Date.now() - t0 };
  }
}

/**
 * Deterministic FIXTURE "model" for tests and offline demos — not a language model. It
 * suggests input validation where request bodies are used and documentation for exported
 * functions, citing the line numbers it was given, so the pipeline can be exercised in CI.
 */
export class FixtureProvider implements LlmProvider {
  readonly name = 'fixture';
  readonly model = 'fixture-heuristic-v1';

  completeJson(_system: string, user: string): Promise<LlmResult> {
    const findings: unknown[] = [];
    let file = '';
    for (const line of user.split('\n')) {
      const f = /^### FILE (.+)$/.exec(line);
      if (f) file = f[1];
      const m = /^L(\d+) \+ (.*)$/.exec(line);
      if (!m || !file) continue;
      const [, n, code] = m;
      if (/\b(?:req|request)\.(?:body|query|params)\b/.test(code) && !/parse|validate|schema/i.test(code))
        findings.push({ path: file, line_start: +n, line_end: +n, category: 'SECURITY', severity: 'MEDIUM', title: 'Request input used without validation', description: 'Request data flows into application logic without visible validation.', evidence: code.trim(), suggested_fix: 'Validate the payload with a schema (e.g. Zod) before use.' });
      if (/^export (?:async )?function \w+/.test(code.trim()))
        findings.push({ path: file, line_start: +n, line_end: +n, category: 'DOCUMENTATION', severity: 'LOW', title: 'Exported function lacks documentation', description: 'A new exported function has no doc comment describing its contract.', evidence: code.trim(), suggested_fix: 'Add a doc comment describing parameters, return value and errors.' });
    }
    return Promise.resolve({ json: { findings }, tokensIn: Math.ceil(user.length / 4), tokensOut: 40 * findings.length, latencyMs: 1 });
  }
}

export const LLM = Symbol('LLM');

@Injectable()
export class LlmFactory {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  create(): LlmProvider {
    const c = this.config;
    if (c.LLM_PROVIDER === 'fixture') return new FixtureProvider();
    if (c.LLM_PROVIDER === 'openai_compatible') return new OpenAICompatibleProvider(c.LLM_MODEL, c.LLM_BASE_URL, c.LLM_API_KEY, c.LLM_TIMEOUT_MS);
    return new OllamaProvider(c.LLM_MODEL, c.LLM_BASE_URL, c.LLM_TIMEOUT_MS);
  }
}
