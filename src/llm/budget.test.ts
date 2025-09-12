import { withBudget } from "@llm/middleware";
import type { LLMClient, Message, GenerateOptions, GenerateResult } from "@llm/LLMClient";

class CountingLLM implements LLMClient {
  name = "counting";
  public callCount = 0;
  constructor(private expectedTokens: number, private delayMs = 5) {}
  async generate(_messages: Message[], _options?: GenerateOptions): Promise<GenerateResult> {
    this.callCount++;
    await new Promise(r => setTimeout(r, this.delayMs));
    return { text: `ok-${this.callCount}`, usage: { totalTokens: 10 } };
  }
  async *stream(): AsyncIterable<{ text: string }> { yield { text: "" }; }
  async generateObject<T>(): Promise<{ object: T; usage?: any; raw?: unknown }> { return { object: {} as T }; }
  async countTokens(_messages: Message[]): Promise<number> { return this.expectedTokens; }
}

describe("withBudget strict TPM and RPD", () => {
  beforeAll(() => { jest.setTimeout(15000); });
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2025-01-01T00:00:00Z"));
  });
  afterEach(() => { jest.useRealTimers(); });

  test("strict TPM pre-reserves before generating", async () => {
    // tpm=50, strict=true; expected tokens per call = 40
    const base = new CountingLLM(40);
    const wrapped = withBudget(base as any, { tpm: 50, strictTpm: true });
    const msgs: Message[] = [{ role: "user", content: "hi" }];

    const p1 = wrapped.generate(msgs);
    await jest.advanceTimersByTimeAsync(5);
    await expect(p1).resolves.toMatchObject({ text: "ok-1" });
    expect(base.callCount).toBe(1);

    // Second call should be held BEFORE base.generate is invoked
    const p2 = wrapped.generate(msgs);
    let resolved = false; p2.then(() => { resolved = true; });

    // Not enough tokens yet: need ~30 tokens => 36s at 50/min
    await jest.advanceTimersByTimeAsync(35_000);
    expect(base.callCount).toBe(1); // generate not called yet
    expect(resolved).toBe(false);

    await jest.advanceTimersByTimeAsync(1_100 + 5);
    expect(base.callCount).toBe(2);
    expect(resolved).toBe(true);
  });

  test("RPD gates second request until next UTC midnight", async () => {
    // Set near midnight to reduce test time
    jest.setSystemTime(new Date("2025-01-01T23:59:00Z"));
    const base = new CountingLLM(1);
    const wrapped = withBudget(base as any, { rpd: 1 });
    const msgs: Message[] = [{ role: "user", content: "hi" }];

    const p1 = wrapped.generate(msgs);
    await jest.advanceTimersByTimeAsync(5);
    await p1;
    expect(base.callCount).toBe(1);

    const p2 = wrapped.generate(msgs);
    let resolved = false; p2.then(() => { resolved = true; });
    await jest.advanceTimersByTimeAsync(59_000);
    expect(resolved).toBe(false);
    expect(base.callCount).toBe(1);

    await jest.advanceTimersByTimeAsync(2_000);
    expect(base.callCount).toBe(2);
    expect(resolved).toBe(true);
  });
});
