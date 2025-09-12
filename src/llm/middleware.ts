import type { LLMClient, Message, GenerateOptions, GenerateResult, LLMUsage, StreamChunk } from "./LLMClient";
import { BudgetManager, type BudgetConfig } from "./limiters";

/**
 * Wrap any LLMClient with budget (RPM/RPD/TPM) enforcement, without modifying the client.
 */
export function withBudget(client: LLMClient, cfg: BudgetConfig & { strictTpm?: boolean }): LLMClient {
  const budget = new BudgetManager(cfg);

  const wrapGenerate = async (messages: Message[], options?: GenerateOptions): Promise<GenerateResult> => {
    let expectedTokens: number | undefined;
    if (budget.enabled && budget.strictTpm && client.countTokens) {
      try { expectedTokens = await client.countTokens(messages); } catch { /* best-effort */ }
    }
    if (budget.enabled) await budget.acquireRequest(expectedTokens);
    const res = await client.generate(messages, options);
    if (budget.enabled) {
      const usage = res.usage;
      const used = usage?.totalTokens ?? ((usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0));
      await budget.noteUsage(used, expectedTokens);
    }
    return res;
  };

  const wrapGenerateObject = async <T>(
    messages: Message[],
    schema: object,
    options?: GenerateOptions
  ): Promise<{ object: T; usage?: LLMUsage; raw?: unknown }> => {
    let expectedTokens: number | undefined;
    if (budget.enabled && budget.strictTpm && client.countTokens) {
      try { expectedTokens = await client.countTokens(messages); } catch { /* best-effort */ }
    }
    if (budget.enabled) await budget.acquireRequest(expectedTokens);
    const res = await client.generateObject<T>(messages, schema, options);
    if (budget.enabled) {
      const usage = res.usage;
      const used = usage?.totalTokens ?? ((usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0));
      await budget.noteUsage(used, expectedTokens);
    }
    return res;
  };

  const wrapStream = async function* (messages: Message[], options?: GenerateOptions): AsyncIterable<StreamChunk> {
    if (budget.enabled) await budget.acquireRequest();
    // Streaming token budgets are not strictly enforced mid-stream.
    for await (const chunk of client.stream(messages, options)) {
      yield chunk;
    }
  };

  return {
    name: client.name,
    generate: wrapGenerate,
    generateObject: wrapGenerateObject,
    stream: wrapStream,
    countTokens: client.countTokens?.bind(client)
  } as LLMClient;
}

