export type Role = "system" | "user" | "assistant";

export interface Message {
  role: Role;
  content: string;
}

export interface LLMUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface GenerateOptions {
  model?: string;
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;      // Gemini: corresponds to maxOutputTokens
  timeoutMs?: number;      // Implement with AbortController
}

export interface GenerateResult {
  text: string;
  usage?: LLMUsage;
  raw?: unknown;           // Raw response if you need to inspect it
}

export interface StreamChunk {
  text: string;
}

export interface LLMClient {
  readonly name: string;

  // Plain text generation
  generate(messages: Message[], options?: GenerateOptions): Promise<GenerateResult>;

  // Streaming (yield text chunks sequentially)
  stream(messages: Message[], options?: GenerateOptions): AsyncIterable<StreamChunk>;

  // Generate a JSON object (provide a JSON Schema)
  generateObject<T>(
    messages: Message[],
    schema: object,
    options?: GenerateOptions
  ): Promise<{ object: T; usage?: LLMUsage; raw?: unknown }>;

  // Optional: estimate token count
  countTokens?(messages: Message[]): Promise<number>;
}
