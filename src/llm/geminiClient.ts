import { GoogleGenerativeAI } from "@google/generative-ai";
import type { LLMClient, Message, GenerateOptions, GenerateResult, LLMUsage } from "./LLMClient";
import { saveErrorToS3 } from "@utils/errorSink";

/** Deep-clone + future-proof place to strip unsupported JSON Schema bits if needed. */
function sanitizeSchemaForGemini<T extends Record<string, any>>(schema: T): T {
  const clone = JSON.parse(JSON.stringify(schema));
  (function strip(node: any) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) node.forEach(strip);
    else Object.values(node).forEach(strip);
  })(clone);
  return clone;
}

/** Normalize SDK usage object (supports multiple shapes). */
function toUsage(u?: any): LLMUsage | undefined {
  if (!u) return undefined;
  return {
    inputTokens: u.promptTokenCount ?? u.inputTokens,
    outputTokens: u.candidatesTokenCount ?? u.outputTokens,
    totalTokens: u.totalTokenCount ?? u.totalTokens
  };
}

/** Lightweight semaphore to cap in-flight calls. */
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

/** Token-bucket RPS limiter. */
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

/** Special error that carries the model's non-JSON text when parsing fails. */
export class NonJsonLLMError extends Error {
  constructor(
    public readonly rawText: string,
    public readonly usage?: LLMUsage,
    public readonly raw?: unknown,
    public readonly s3Key?: string,
    message = "Gemini returned non-JSON"
  ) {
    super(message);
    this.name = "NonJsonLLMError";
  }
}

/** Sleep helper. */
function sleep(ms: number) { return new Promise(res => setTimeout(res, ms)); }

/** Exponential backoff with full jitter. */
function backoffMs(attempt: number, base: number, cap: number) {
  const exp = Math.min(cap, base * Math.pow(2, attempt)); // 0,1,2,.. -> base, 2*base, 4*base...
  return Math.floor(Math.random() * (exp + 1));           // full jitter
}

/** Decide if an error is retriable. */
function isRetriableError(e: any): boolean {
  const status = e?.status ?? e?.response?.status;
  if (status === 503 || status === 429 || status === 500 || status === 408) return true;
  const code = e?.code || e?.errno;
  // Network-ish errors
  return ["ETIMEDOUT", "ECONNRESET", "ENETUNREACH", "EAI_AGAIN"].includes(code);
}

export class GeminiClient implements LLMClient {
  readonly name = "gemini";
  private genAI: GoogleGenerativeAI;
  private defaultModel: string;

  // Client-side controls
  private limiter?: RpsLimiter;
  private sem?: Semaphore;
  private defaultTimeoutMs = 60_000;

  /**
   * @param apiKey Gemini API key
   * @param model Default model name (e.g., "gemini-1.5-pro")
   * @param rps Per-client RPS limit (token-bucket). If omitted, disabled.
   * @param burst Token-bucket burst capacity (defaults to rps).
   * @param maxConcurrency Max in-flight calls within this client. If omitted, disabled.
   * @param timeoutMs Default timeout for requests (ms).
   */
  constructor(opts: {
    apiKey: string;
    model?: string;
    rps?: number;
    burst?: number;
    maxConcurrency?: number;
    timeoutMs?: number;
  }) {
    this.genAI = new GoogleGenerativeAI(opts.apiKey);
    this.defaultModel = opts.model ?? "gemini-1.5-pro";

    const rps = opts.rps ?? Number(process.env.GEMINI_RPS ?? 0);
    const burst = opts.burst ?? (rps || Number(process.env.GEMINI_BURST ?? 0));
    if (rps > 0) this.limiter = new RpsLimiter(rps, burst);

    const mc = opts.maxConcurrency ?? Number(process.env.GEMINI_MAX_CONCURRENCY ?? 0);
    if (mc > 0) this.sem = new Semaphore(mc);

    if (opts.timeoutMs && Number.isFinite(opts.timeoutMs)) this.defaultTimeoutMs = opts.timeoutMs!;
  }

  /** Build model with optional system instruction. */
  private buildModel(modelName: string, systemInstruction?: string) {
    const base = { model: modelName };
    return this.genAI.getGenerativeModel(
      systemInstruction
        ? { ...base, systemInstruction: { role: "system", parts: [{ text: systemInstruction }] } as any }
        : base
    );
  }

  /** Map GenerateOptions to Gemini SDK generationConfig. */
  private toGenConfig(o?: GenerateOptions) {
    const cfg: any = {};
    if (!o) return cfg;
    if (o.temperature != null) cfg.temperature = o.temperature;
    if (o.topP != null) cfg.topP = o.topP;
    if (o.topK != null) cfg.topK = o.topK;
    return cfg;
  }

  /**
   * Wrap a promise with client-side throttling (RPS, concurrency) and a coarse timeout.
   * If the SDK supports AbortSignal in the future, replace with a true abort.
   */
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
      new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`GeminiClient timeout after ${t}ms`)), t))
    ]) as Promise<T>;
  }

  /** Retry wrapper with exponential backoff + jitter. */
  private async withRetry<T>(op: () => Promise<T>): Promise<T> {
    const max = Number(process.env.GEMINI_RETRY_MAX ?? 3);
    const base = Number(process.env.GEMINI_RETRY_BASE_MS ?? 1000);
    const cap  = Number(process.env.GEMINI_RETRY_MAX_MS ?? 8000);

    let lastErr: any;
    for (let attempt = 0; attempt <= max; attempt++) {
      try {
        return await op();
      } catch (e) {
        lastErr = e;
        if (attempt === max || !isRetriableError(e)) break;
        await sleep(backoffMs(attempt, base, cap));
      }
    }
    throw lastErr;
  }

  /** Plain text generation. */
  async generate(messages: Message[], options?: GenerateOptions): Promise<GenerateResult> {
    const systemInstruction = messages.filter(m => m.role === "system").map(m => m.content).join("\n\n") || undefined;
    const nonSystem = messages.filter(m => m.role !== "system");
    const model = this.buildModel(options?.model ?? this.defaultModel, systemInstruction);
    const contents = nonSystem.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    }));

    // Retry each full attempt, and on each attempt throttle+timeout apply.
    return this.withRetry(() =>
      this.withThrottle(async () => {
        const res = await model.generateContent({ contents, generationConfig: this.toGenConfig(options) });
        const text = res.response?.text?.() ?? "";
        return { text, usage: toUsage(res.response?.usageMetadata), raw: res };
      }, options?.timeoutMs)
    );
  }

  /** Server-sent streaming (yields incremental text). */
  async *stream(messages: Message[], options?: GenerateOptions) {
    const systemInstruction = messages.filter(m => m.role === "system").map(m => m.content).join("\n\n") || undefined;
    const nonSystem = messages.filter(m => m.role !== "system");
    const model = this.buildModel(options?.model ?? this.defaultModel, systemInstruction);
    const contents = nonSystem.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    }));

    // Retry only the stream creation; mid-stream failures are not retried.
    const res = await this.withRetry(() =>
      this.withThrottle(
        () => model.generateContentStream({ contents, generationConfig: this.toGenConfig(options) }),
        options?.timeoutMs
      )
    );
    for await (const chunk of res.stream) {
      const t = chunk?.text?.();
      if (t) yield { text: t };
    }
  }

  /**
   * JSON object generation with schema enforcement.
   *
   * Parse error behavior:
   *  - Default: throws NonJsonLLMError(rawText, usage, raw, s3Key?) so caller can access the model output.
   *  - If (options as any).onParseError === "return_raw": returns object as {} and attaches { nonJsonText, response } in `raw`.
   */
  async generateObject<T>(
    messages: Message[],
    schema: object,
    options?: GenerateOptions
  ): Promise<{ object: T; usage?: LLMUsage; raw?: unknown }> {
    const systemInstruction = messages.filter(m => m.role === "system").map(m => m.content).join("\n\n") || undefined;
    const nonSystem = messages.filter(m => m.role !== "system");
    const model = this.buildModel(options?.model ?? this.defaultModel, systemInstruction);
    const contents = nonSystem.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    }));

    const sanitized = sanitizeSchemaForGemini(schema);

    return this.withRetry(() =>
      this.withThrottle(async () => {
        const res = await model.generateContent({
          contents,
          generationConfig: {
            ...this.toGenConfig(options),
            responseMimeType: "application/json",
            responseSchema: sanitized
          }
        });

        // Be resilient to SDK changes
        const text =
          res?.response?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ??
          res?.response?.text?.() ??
          "";

        try {
          const parsed = JSON.parse(text) as T;
          return { object: parsed, usage: toUsage(res.response?.usageMetadata), raw: res };
        } catch {
          // 1) Try to salvage the largest JSON block
          const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
          if (m) {
            try {
              const parsed = JSON.parse(m[0]) as T;
              return { object: parsed, usage: toUsage(res.response?.usageMetadata), raw: res };
            } catch { /* ignore and continue */ }
          }

          // 2) Save raw text to S3 (best-effort) and either throw or return raw
          let s3Key: string | undefined;
          try {
            const result = await saveErrorToS3?.({
              error: new Error("Gemini returned non-JSON"),
              payload: text,
              keyHint: "gemini-nonjson"
            });
            s3Key = result?.key;
          } catch { /* best-effort only */ }

          const usage = toUsage(res.response?.usageMetadata);
          const preview = text.slice(0, 200).replace(/\n/g, "\\n");

          if ((options as any)?.onParseError === "return_raw") {
            return {
              object: {} as T,
              usage,
              raw: { nonJsonText: text, response: res, s3Key, note: "parse-error-return_raw", preview }
            };
          }

          throw new NonJsonLLMError(
            text,
            usage,
            res,
            s3Key,
            `Gemini returned non-JSON (preview="${preview}")`
          );
        }
      }, options?.timeoutMs)
    );
  }

  /** Token counting (useful for budgeting). */
  async countTokens(messages: Message[]): Promise<number> {
    const systemInstruction = messages.filter(m => m.role === "system").map(m => m.content).join("\n\n") || undefined;
    const nonSystem = messages.filter(m => m.role !== "system");
    const model = this.buildModel(this.defaultModel, systemInstruction);
    const contents = nonSystem.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    }));
    return this.withRetry(() =>
      this.withThrottle(async () => {
        const res = await model.countTokens({ contents });
        return res.totalTokens ?? 0;
      })
    );
  }
}
