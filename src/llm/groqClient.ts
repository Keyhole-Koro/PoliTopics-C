import type { LLMClient, Message, GenerateOptions, GenerateResult, LLMUsage } from "./LLMClient";
import { BudgetManager, parseBool } from "./limiters";
import { saveErrorToS3 } from "@utils/errorSink";

// Utilities (mirrors Gemini client helpers)
class Semaphore {
  private queue: Array<() => void> = [];
  private slots: number;
  constructor(n: number) { this.slots = Math.max(1, n); }
  async acquire() {
    if (this.slots > 0) { this.slots--; return; }
    await new Promise<void>(res => this.queue.push(res));
  }
  release() {
    const next = this.queue.shift();
    if (next) next(); else this.slots++;
  }
}

class RpsLimiter {
  private tokens: number;
  private lastMs = Date.now();
  private readonly perMs: number;
  private readonly cap: number;
  constructor(rps: number, burst?: number) {
    const rate = Math.max(1, Math.floor(rps));
    this.cap = Math.max(1, Math.floor(burst ?? rate));
    this.tokens = this.cap;
    this.perMs = rate / 1000;
  }
  private refill() {
    const now = Date.now();
    const dt = now - this.lastMs;
    if (dt > 0) {
      this.tokens = Math.min(this.cap, this.tokens + dt * this.perMs);
      this.lastMs = now;
    }
  }
  async acquire() {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) { this.tokens -= 1; return; }
      const waitMs = Math.ceil((1 - this.tokens) / this.perMs);
      await new Promise(r => setTimeout(r, Math.max(1, waitMs)));
    }
  }
}

function sleep(ms: number) { return new Promise(res => setTimeout(res, ms)); }
function backoffMs(attempt: number, base: number, cap: number) {
  const exp = Math.min(cap, base * Math.pow(2, attempt));
  return Math.floor(Math.random() * (exp + 1));
}
function isRetriableError(e: any): boolean {
  const status = e?.status ?? e?.response?.status;
  if (status === 503 || status === 429 || status === 500 || status === 408) return true;
  const code = e?.code || e?.errno;
  return ["ETIMEDOUT", "ECONNRESET", "ENETUNREACH", "EAI_AGAIN"].includes(code);
}

function toUsage(u?: any): LLMUsage | undefined {
  if (!u) return undefined;
  return {
    inputTokens: u.prompt_tokens ?? u.inputTokens,
    outputTokens: u.completion_tokens ?? u.outputTokens,
    totalTokens: u.total_tokens ?? u.totalTokens
  };
}

type OpenAIMessage = { role: "system"|"user"|"assistant"; content: string };

/**
 * Groq client using OpenAI-compatible Chat Completions API.
 * Default baseUrl: https://api.groq.com/openai/v1
 */
export class GroqClient implements LLMClient {
  readonly name = "groq";

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private defaultModel: string;
  private defaultTimeoutMs = 60_000;

  private limiter?: RpsLimiter;
  private sem?: Semaphore;
  private budget?: BudgetManager;

  constructor(opts: {
    apiKey: string;
    baseUrl?: string;        // OpenAI-compatible base
    model?: string;          // default model name
    rps?: number;            // per-client RPS
    burst?: number;          // token bucket burst
    maxConcurrency?: number; // in-flight limit
    timeoutMs?: number;      // default timeout
  }) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl || process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
    this.defaultModel = opts.model || process.env.GROQ_MODEL_NAME || "llama-3.1-70b-versatile";

    const rps = opts.rps ?? Number(process.env.GROQ_RPS ?? process.env.LLM_RPS ?? 0);
    const burst = opts.burst ?? (rps || Number(process.env.GROQ_BURST ?? process.env.LLM_BURST ?? 0));
    if (rps > 0) this.limiter = new RpsLimiter(rps, burst);

    const mc = opts.maxConcurrency ?? Number(process.env.GROQ_MAX_CONCURRENCY ?? process.env.LLM_MAX_CONCURRENCY ?? 0);
    if (mc > 0) this.sem = new Semaphore(mc);

    if (opts.timeoutMs && Number.isFinite(opts.timeoutMs)) this.defaultTimeoutMs = opts.timeoutMs!;

    // Per-minute/day/token budgets
    const rpm = Number(process.env.GROQ_RPM ?? process.env.LLM_RPM ?? 0);
    const rpd = Number(process.env.GROQ_RPD ?? process.env.LLM_RPD ?? 0);
    const tpm = Number(process.env.GROQ_TPM ?? process.env.LLM_TPM ?? 0);
    const strict = parseBool(process.env.GROQ_TPM_STRICT ?? process.env.LLM_TPM_STRICT);
    if ((rpm > 0) || (rpd > 0) || (tpm > 0)) {
      this.budget = new BudgetManager({ rpm, rpd, tpm, strictTpm: strict });
    }
  }

  private mapMessages(msgs: Message[]): OpenAIMessage[] {
    return msgs.map(m => ({ role: m.role, content: m.content } as OpenAIMessage));
  }

  private async withThrottle<T>(fn: () => Promise<T>, timeoutMs?: number): Promise<T> {
    const run = async () => {
      if (this.limiter) await this.limiter.acquire();
      return fn();
    };
    const exec = this.sem
      ? (async () => { await this.sem!.acquire(); try { return await run(); } finally { this.sem!.release(); } })()
      : run();

    const t = timeoutMs ?? this.defaultTimeoutMs;
    if (!t || !Number.isFinite(t) || t <= 0) return exec;
    return Promise.race([
      exec,
      new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`GroqClient timeout after ${t}ms`)), t))
    ]) as Promise<T>;
  }

  private async withRetry<T>(op: () => Promise<T>): Promise<T> {
    const max = Number(process.env.GROQ_RETRY_MAX ?? process.env.LLM_RETRY_MAX ?? 3);
    const base = Number(process.env.GROQ_RETRY_BASE_MS ?? process.env.LLM_RETRY_BASE_MS ?? 1000);
    const cap  = Number(process.env.GROQ_RETRY_MAX_MS ?? process.env.LLM_RETRY_MAX_MS ?? 8000);

    let lastErr: any;
    for (let attempt = 0; attempt <= max; attempt++) {
      try { return await op(); }
      catch (e) {
        lastErr = e;
        if (attempt === max || !isRetriableError(e)) break;
        await sleep(backoffMs(attempt, base, cap));
      }
    }
    throw lastErr;
  }

  private async postChat(body: any): Promise<any> {
    const url = `${this.baseUrl}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body)
    } as RequestInit);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err: any = new Error(`Groq API ${res.status} ${res.statusText}`);
      (err as any).status = res.status;
      (err as any).body = text;
      throw err;
    }
    return res.json();
  }

  private toChatBody(messages: Message[], options?: GenerateOptions): any {
    const body: any = {
      model: options?.model ?? this.defaultModel,
      messages: this.mapMessages(messages),
      temperature: options?.temperature,
      top_p: options?.topP,
      // OpenAI-compatible params; ignore topK
      stream: false
    };
    // Try to request JSON if the API supports it; harmless if ignored
    (body as any).response_format = (options as any)?.response_format ?? undefined;
    return body;
  }

  async generate(messages: Message[], options?: GenerateOptions): Promise<GenerateResult> {
    if (this.budget?.enabled) await this.budget.acquireRequest();
    const body = this.toChatBody(messages, options);
    const res = await this.withRetry(() => this.withThrottle(() => this.postChat(body), options?.timeoutMs));
    const text: string = res?.choices?.[0]?.message?.content ?? "";
    const usage = toUsage(res?.usage);
    if (this.budget?.enabled) {
      const used = usage?.totalTokens ?? ((usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0));
      await this.budget.noteUsage(used);
    }
    return { text, usage, raw: res };
  }

  async *stream(messages: Message[], options?: GenerateOptions) {
    // Minimal implementation: non-streaming fallback yields full text once
    const { text } = await this.generate(messages, options);
    if (text) yield { text };
  }

  async generateObject<T>(
    messages: Message[],
    schema: object,
    options?: GenerateOptions
  ): Promise<{ object: T; usage?: LLMUsage; raw?: unknown }> {
    // Encourage JSON via system/user hint
    const schemaPrompt = `Return ONLY valid JSON matching this JSON Schema (no prose):\n${JSON.stringify(schema)}`;
    const augmented: Message[] = [
      { role: "system", content: "You are a helpful assistant. Respond with JSON only." },
      ...messages,
      { role: "user", content: schemaPrompt }
    ];

    // Prefer response_format if accepted by server
    const body = {
      ...this.toChatBody(augmented, options),
      response_format: { type: "json_object" }
    };

    if (this.budget?.enabled) await this.budget.acquireRequest();
    const res = await this.withRetry(() => this.withThrottle(() => this.postChat(body), options?.timeoutMs));
    const text: string = res?.choices?.[0]?.message?.content ?? "";

    try {
      const parsed = JSON.parse(text) as T;
      const usage = toUsage(res?.usage);
      if (this.budget?.enabled) {
        const used = usage?.totalTokens ?? ((usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0));
        await this.budget.noteUsage(used);
      }
      return { object: parsed, usage, raw: res };
    } catch {
      // Try to salvage
      const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (m) {
        try {
          const parsed = JSON.parse(m[0]) as T;
          const usage = toUsage(res?.usage);
          if (this.budget?.enabled) {
            const used = usage?.totalTokens ?? ((usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0));
            await this.budget.noteUsage(used);
          }
          return { object: parsed, usage, raw: res };
        } catch { /* ignore */ }
      }

      // Save raw to S3 (best-effort)
      let s3Key: string | undefined;
      try {
        const result = await saveErrorToS3?.({
          error: new Error("Groq returned non-JSON"),
          payload: text,
          keyHint: "groq-nonjson"
        });
        s3Key = result?.key;
      } catch { /* ignore */ }

      const usage = toUsage(res?.usage);
      const preview = text.slice(0, 200).replace(/\n/g, "\\n");

      if ((options as any)?.onParseError === "return_raw") {
        return { object: {} as T, usage, raw: { nonJsonText: text, response: res, s3Key, note: "parse-error-return_raw", preview } };
      }

      const err = new Error(`Groq returned non-JSON (preview="${preview}")`);
      (err as any).rawText = text;
      (err as any).usage = usage;
      (err as any).raw = res;
      (err as any).s3Key = s3Key;
      throw err;
    }
  }

  // countTokens intentionally omitted; API may vary per model
}
