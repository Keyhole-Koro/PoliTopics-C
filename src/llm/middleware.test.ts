import { withBudget } from "@llm/middleware";
import type { LLMClient, Message, GenerateOptions, GenerateResult } from "@llm/LLMClient";

class FakeLLM implements LLMClient {
  name = "fake";
  public callCount = 0;
  public outputs: Array<{ text: string; tokens?: { in?: number; out?: number } }> = [];
  constructor(outputs?: Array<{ text: string; tokens?: { in?: number; out?: number } }>) {
    this.outputs = outputs ?? [];
  }
  async generate(_messages: Message[], _options?: GenerateOptions): Promise<GenerateResult> {
    this.callCount++;
    const i = this.callCount - 1;
    const out = this.outputs[i] ?? { text: "ok", tokens: { in: 10, out: 10 } };
    await new Promise(r => setTimeout(r, 10));
    const usage = out.tokens ? {
      inputTokens: out.tokens.in ?? 0,
      outputTokens: out.tokens.out ?? 0,
      totalTokens: (out.tokens.in ?? 0) + (out.tokens.out ?? 0)
    } : undefined;
    return { text: out.text, usage };
  }
  async *stream(): AsyncIterable<{ text: string }> { yield { text: "not-used" }; }
  async generateObject<T>(): Promise<{ object: T; usage?: any; raw?: unknown }> {
    return { object: {} as T };
  }
}

describe("withBudget middleware", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2025-01-01T00:00:00Z"));
  });
  afterEach(() => { jest.useRealTimers(); });

  test("enforces RPM across multiple calls", async () => {
    // rpm=2 => bucket starts with 2 tokens; 3rd call waits ~30s for refill
    const base = new FakeLLM([{ text: "a" }, { text: "b" }, { text: "c" }]);
    const wrapped = withBudget(base as any, { rpm: 2 });

    const msgs: Message[] = [{ role: "user", content: "hi" }];
    const p1 = wrapped.generate(msgs);
    const p2 = wrapped.generate(msgs);
    const p3 = wrapped.generate(msgs);

    // progress minimal time for first two (10ms each)
    await jest.advanceTimersByTimeAsync(10);
    const r1 = await p1; const r2 = await p2;
    expect(r1.text).toBe("a");
    expect(r2.text).toBe("b");

    // Third should still be pending until ~30s refill + 10ms work
    let resolved = false; p3.then(()=>{ resolved = true; });
    await jest.advanceTimersByTimeAsync(29_000);
    expect(resolved).toBe(false);

    await jest.advanceTimersByTimeAsync(1_010 + 10); // reach 30s+ and complete work
    expect(resolved).toBe(true);
  });

  test("accounts TPM post-call (non-strict)", async () => {
    // tpm=100, first uses 80 tokens, second uses 80 tokens -> needs ~60 tokens refill => ~36s wait
    const base = new FakeLLM([
      { text: "x", tokens: { in: 50, out: 30 } },
      { text: "y", tokens: { in: 50, out: 30 } },
    ]);
    const wrapped = withBudget(base as any, { tpm: 100, strictTpm: false });
    const msgs: Message[] = [{ role: "user", content: "hi" }];

    const p1 = wrapped.generate(msgs);
    await jest.advanceTimersByTimeAsync(10);
    await expect(p1).resolves.toMatchObject({ text: "x" });

    const p2 = wrapped.generate(msgs);
    let resolved = false; p2.then(()=>{ resolved = true; });
    // Need ~60 tokens to replenish at 100/min => 60/ (100/60000) = 36000 ms
    await jest.advanceTimersByTimeAsync(35_000);
    expect(resolved).toBe(false);

    await jest.advanceTimersByTimeAsync(1_500 + 10);
    expect(resolved).toBe(true);
  });
});
