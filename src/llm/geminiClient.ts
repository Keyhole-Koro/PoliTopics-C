import { GoogleGenerativeAI } from "@google/generative-ai";
import type { LLMClient, Message, GenerateOptions, GenerateResult, LLMUsage } from "./LLMClient";

function sanitizeSchemaForGemini<T extends Record<string, any>>(schema: T): T {
  const clone = JSON.parse(JSON.stringify(schema));
  (function strip(node: any) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) node.forEach(strip);
    else Object.values(node).forEach(strip);
  })(clone);
  return clone;
}

function toUsage(u?: any): LLMUsage | undefined {
  if (!u) return undefined;
  return {
    inputTokens: u.promptTokenCount ?? u.inputTokens,
    outputTokens: u.candidatesTokenCount ?? u.outputTokens,
    totalTokens: u.totalTokenCount ?? u.totalTokens
  };
}

export class GeminiClient implements LLMClient {
  readonly name = "gemini";
  private genAI: GoogleGenerativeAI;
  private defaultModel: string;

  constructor(opts: { apiKey: string; model?: string }) {
    this.genAI = new GoogleGenerativeAI(opts.apiKey);
    this.defaultModel = opts.model ?? "gemini-1.5-pro";
  }

  private buildModel(modelName: string, systemInstruction?: string) {
    const base = { model: modelName };
    return this.genAI.getGenerativeModel(
      systemInstruction
        ? { ...base, systemInstruction: { role: "system", parts: [{ text: systemInstruction }] } as any }
        : base
    );
  }

  private toGenConfig(o?: GenerateOptions) {
    const cfg: any = {};
    if (!o) return cfg;
    if (o.temperature != null) cfg.temperature = o.temperature;
    if (o.topP != null) cfg.topP = o.topP;
    if (o.topK != null) cfg.topK = o.topK;
    if (o.maxTokens != null) cfg.maxOutputTokens = o.maxTokens;
    return cfg;
  }

  async generate(messages: Message[], options?: GenerateOptions): Promise<GenerateResult> {
    const systemInstruction = messages.filter(m => m.role === "system").map(m => m.content).join("\n\n") || undefined;
    const nonSystem = messages.filter(m => m.role !== "system");
    const model = this.buildModel(options?.model ?? this.defaultModel, systemInstruction);

    const contents = nonSystem.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    const res = await model.generateContent({ contents, generationConfig: this.toGenConfig(options) });
    const text = res.response?.text?.() ?? "";
    return { text, usage: toUsage(res.response?.usageMetadata), raw: res };
  }

  async *stream(messages: Message[], options?: GenerateOptions) {
    const systemInstruction = messages.filter(m => m.role === "system").map(m => m.content).join("\n\n") || undefined;
    const nonSystem = messages.filter(m => m.role !== "system");
    const model = this.buildModel(options?.model ?? this.defaultModel, systemInstruction);
    const contents = nonSystem.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));

    const res = await model.generateContentStream({ contents, generationConfig: this.toGenConfig(options) });
    for await (const chunk of res.stream) {
      const t = chunk?.text?.();
      if (t) yield { text: t };
    }
  }

  async generateObject<T>(
    messages: Message[],
    schema: object,
    options?: GenerateOptions
  ): Promise<{ object: T; usage?: LLMUsage; raw?: unknown }> {
    const systemInstruction = messages.filter(m => m.role === "system").map(m => m.content).join("\n\n") || undefined;
    const nonSystem = messages.filter(m => m.role !== "system");
    const model = this.buildModel(options?.model ?? this.defaultModel, systemInstruction);
    const contents = nonSystem.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));

    const sanitized = sanitizeSchemaForGemini(schema);

    const res = await model.generateContent({
      contents,
      generationConfig: {
        ...this.toGenConfig(options),
        // ✅ use camelCase for SDK
        responseMimeType: "application/json",
        responseSchema: sanitized
      }
    });

    // Prefer candidates text join to be safe across SDK updates
    const text =
      res?.response?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ??
      res?.response?.text?.() ?? "";

    try {
      const parsed = JSON.parse(text) as T;
      return { object: parsed, usage: toUsage(res.response?.usageMetadata), raw: res };
    } catch {
      // Fallback: try to extract the largest JSON block
      const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (m) {
        const trimmed = m[0];
        const parsed = JSON.parse(trimmed) as T;
        return { object: parsed, usage: toUsage(res.response?.usageMetadata), raw: res };
      }
      // If still no luck, throw with a short preview
      const preview = text.slice(0, 200).replace(/\n/g, "\\n");
      throw new Error(`Gemini returned non-JSON. Preview: ${preview}...`);
    }
  }

  async countTokens(messages: Message[]): Promise<number> {
    const systemInstruction = messages.filter(m => m.role === "system").map(m => m.content).join("\n\n") || undefined;
    const nonSystem = messages.filter(m => m.role !== "system");
    const model = this.buildModel(this.defaultModel, systemInstruction);
    const contents = nonSystem.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    const res = await model.countTokens({ contents });
    return res.totalTokens ?? 0;
  }
}
