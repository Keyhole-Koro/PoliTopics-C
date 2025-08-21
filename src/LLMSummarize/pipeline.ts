// Summarization pipeline that NEVER cuts dialog.original_text.
// - Build Dialog[] from RawMeetingRecord (order by speechID part / speechOrder)
// - Pack dialogs greedily by charThreshold (sum of original_text length)
// - Per chunk (IN PARALLEL): ask LLM for middle_summary + optional per-dialog summaries/soft_language
// - Final reduce (PARALLEL TREE): consolidate all middle_summaries into final summary/soft_summary
// - Batch over RawMeetingData (IN PARALLEL with bounded concurrency)
// - RPS limiter: throttle LLM calls by requests-per-second + burst (token-bucket)

import type {
  Article, Dialog, Keyword, MiddleSummary, Participant, SoftSummary, Summary, Term
} from "@interfaces/Article";
import type { RawMeetingData, RawMeetingRecord, RawSpeechRecord } from "@interfaces/Raw";
import type { LLMClient, Message, GenerateOptions } from "@llm/LLMClient";

// Greedy packer (no cutting)
import {
  buildOrderLen,
  packIndexSetsByGreedy,
  materializeChunks,
  type IndexPack
} from "./packing";

// ---------------- Rate limiter (token-bucket) ----------------

/** Sleep helper */
const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

/**
 * Token-bucket RPS limiter.
 * - `rps`: average refill rate (tokens per second)
 * - `burst`: maximum bucket capacity (initial + ceiling)
 * Call `acquire()` once per outgoing LLM request.
 */
class RpsLimiter {
  private tokens: number;
  private lastRefillMs: number;
  private readonly refillPerMs: number;
  private readonly capacity: number;

  constructor(rps: number, burst?: number) {
    const rate = Math.max(1, Math.floor(rps));
    const cap = Math.max(1, Math.floor(burst ?? rate));
    this.tokens = cap;
    this.capacity = cap;
    this.refillPerMs = rate / 1000;
    this.lastRefillMs = Date.now();
  }

  /** Refill tokens based on elapsed time since last refill. */
  private refill() {
    const now = Date.now();
    const elapsed = Math.max(0, now - this.lastRefillMs);
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
      this.lastRefillMs = now;
    }
  }

  /** Wait until a token is available, then consume 1 token. */
  async acquire(): Promise<void> {
    while (true) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      // Time until next token is available
      const needed = 1 - this.tokens;
      const waitMs = Math.ceil(needed / this.refillPerMs);
      await sleep(Math.max(1, waitMs));
    }
  }
}

// Global limiter instance (tune via env vars)
const LLM_RPS = Math.max(1, Number(process.env.LLM_RPS ?? 4));
const LLM_BURST = Math.max(1, Number(process.env.LLM_BURST ?? LLM_RPS));
export const llmLimiter = new RpsLimiter(LLM_RPS, LLM_BURST);

// ---------------- Small utilities ----------------

/** Extract numeric order from speechID.split("_")[1], fallback to speechOrder, fallback to idx+1. */
function getSpeechNumericOrder(s: RawSpeechRecord, idx: number): number {
  const idPart = s.speechID?.split("_")[1];
  const byId = idPart ? Number(idPart) : NaN;
  if (!Number.isNaN(byId)) return byId;
  if (typeof s.speechOrder === "number" && !Number.isNaN(s.speechOrder)) return s.speechOrder;
  return idx + 1;
}

/** Sort speeches by numeric order derived from ID (primary) then speechOrder. */
function sortSpeeches(raw: RawMeetingRecord): RawSpeechRecord[] {
  return [...raw.speechRecord].sort((a, b) => {
    const ao = getSpeechNumericOrder(a, 0);
    const bo = getSpeechNumericOrder(b, 0);
    return ao - bo;
  });
}

/** Convert one RawSpeechRecord into a Dialog WITHOUT any splitting. */
function toDialog(s: RawSpeechRecord, order: number): Dialog {
  return {
    order, // unique per speech (as provided)
    speaker: s.speaker ?? "",
    speaker_group: s.speakerGroup ?? "",
    speaker_position: s.speakerPosition ?? "",
    speaker_role: s.speakerRole ?? "",
    original_text: s.speech ?? "",
    summary: "",
    soft_language: ""
  };
}

/** Build Dialog[] for a meeting (no splitting). */
function buildDialogs(raw: RawMeetingRecord): Dialog[] {
  const speeches = sortSpeeches(raw);
  const dialogs: Dialog[] = [];
  for (let i = 0; i < speeches.length; i++) {
    const s = speeches[i];
    const ord = getSpeechNumericOrder(s, i);
    dialogs.push(toDialog(s, ord));
  }
  return dialogs;
}

/** Build meta (title/description are placeholders; often refined by LLM). */
function buildMeta(raw: RawMeetingRecord): Required<Pick<Article, "id"|"title"|"date"|"imageKind"|"session"|"nameOfHouse"|"nameOfMeeting"|"category"|"description">> {
  const allowed = new Set(["会議録","目次","索引","附録","追録"]);
  const imageKind = allowed.has(raw.imageKind) ? (raw.imageKind as Article["imageKind"]) : "会議録";
  const title = raw.issue || `${raw.nameOfMeeting}（${raw.date}）`;
  const description = "This article summarizes the meeting in easy-to-understand language for general readers.";
  return {
    id: raw.issueID,
    title,
    date: raw.date,
    imageKind,
    session: raw.session,
    nameOfHouse: raw.nameOfHouse,
    nameOfMeeting: raw.nameOfMeeting,
    category: "",
    description
  };
}

// ---------------- JSON Schemas (Gemini-friendly) ----------------
// No additionalProperties anywhere; integer fields use "integer".

const chunkSchema = {
  type: "object",
  properties: {
    dialogs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          order: { type: "integer" },
          summary: { type: "string" },
          soft_language: { type: "string" }
        },
        required: ["order"]
      }
    },
    middle_summary: {
      type: "object",
      properties: {
        based_on_orders: { type: "array", items: { type: "integer" } },
        summary: { type: "string" }
      },
      required: ["based_on_orders", "summary"]
    },
    terms: {
      type: "array",
      items: {
        type: "object",
        properties: { term: { type: "string" }, definition: { type: "string" } },
        required: ["term", "definition"]
      }
    },
    keywords: {
      type: "array",
      items: {
        type: "object",
        properties: {
          keyword: { type: "string" },
          priority: { type: "string", enum: ["high","medium","low"] }
        },
        required: ["keyword", "priority"]
      }
    },
    participants: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, summary: { type: "string" } },
        required: ["name", "summary"]
      }
    },
    outline: { type: "array", items: { type: "string" } }
  },
  required: ["middle_summary"]
} as const;

const reduceSchema = {
  type: "object",
  properties: {
    summary: {
      type: "object",
      properties: {
        based_on_orders: { type: "array", items: { type: "integer" } },
        summary: { type: "string" }
      },
      required: ["based_on_orders", "summary"]
    },
    soft_summary: {
      type: "object",
      properties: {
        based_on_orders: { type: "array", items: { type: "integer" } },
        summary: { type: "string" }
      },
      required: ["based_on_orders", "summary"]
    },
    title: { type: "string" },
    description: { type: "string" },
    keywords: {
      type: "array",
      items: {
        type: "object",
        properties: {
          keyword: { type: "string" },
          priority: { type: "string", enum: ["high","medium","low"] }
        },
        required: ["keyword", "priority"]
      }
    }
  },
  required: ["summary", "soft_summary"]
} as const;

// ---------------- LLM prompt builders ----------------

/** Merge generated dialog summaries into the original chunk by order. */
function mergeDialogSummaries(original: Dialog[], updates?: Array<Pick<Dialog,"order"|"summary"|"soft_language">>): Dialog[] {
  if (!updates?.length) return original;
  const byOrder = new Map<number, Dialog>(original.map(d => [d.order, d]));
  for (const u of updates) {
    const d = byOrder.get(u.order);
    if (!d) continue;
    if (typeof u.summary === "string") d.summary = u.summary;
    if (typeof u.soft_language === "string") d.soft_language = u.soft_language;
  }
  return [...byOrder.values()].sort((a,b)=>a.order-b.order);
}

/** Build messages for a chunk. */
function buildChunkMessages(args: {
  instruction: string;
  output_format: string;
  meta: ReturnType<typeof buildMeta>;
  chunkDialogs: Dialog[];
  chunkIndex: number;
  chunkCount: number;
}): Message[] {
  const { instruction, output_format, meta, chunkDialogs, chunkIndex, chunkCount } = args;

  const system: Message = {
    role: "system",
    content:
      "You are an expert assistant that summarizes Japanese parliamentary minutes for general readers. " +
      "Return ONLY JSON that strictly conforms to the provided schema."
  };

  const user: Message = {
    role: "user",
    content:
`Return ONLY JSON for the following task.

Spec:
${instruction}

Output format (for reference):
${output_format}

Meta:
${JSON.stringify({
  id: meta.id,
  date: meta.date,
  house: meta.nameOfHouse,
  meeting: meta.nameOfMeeting,
  session: meta.session
})}

Chunk info:
{"index": ${chunkIndex}, "count": ${chunkCount}, "based_on_orders": ${JSON.stringify(chunkDialogs.map(d=>d.order))}}

Dialogs:
${JSON.stringify(chunkDialogs)}
`
  };

  return [system, user];
}

/** Build messages for reduce (middle summaries -> final summary/soft_summary). */
function buildReduceMessages(args: {
  instruction: string;
  output_format: string;
  meta: ReturnType<typeof buildMeta>;
  middle_summaries: MiddleSummary[];
}): Message[] {
  const { instruction, output_format, meta, middle_summaries } = args;

  const system: Message = {
    role: "system",
    content:
      "You consolidate chunk-level middle summaries into a final Summary and SoftSummary. " +
      "Return ONLY JSON that strictly conforms to the provided schema."
  };

  const user: Message = {
    role: "user",
    content:
`Return ONLY JSON.

Spec:
${instruction}

Output format (for reference):
${output_format}

Meta:
${JSON.stringify({
  id: meta.id,
  date: meta.date,
  house: meta.nameOfHouse,
  meeting: meta.nameOfMeeting,
  session: meta.session
})}

Middle summaries:
${JSON.stringify(middle_summaries)}
`
  };

  return [system, user];
}

// ---------------- Parallel helpers ----------------

/** Bounded parallel map that preserves input order in the result array. */
async function mapWithConcurrency<I, O>(
  items: I[],
  limit: number,
  worker: (item: I, index: number) => Promise<O>
): Promise<O[]> {
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(`mapWithConcurrency: invalid limit=${limit}`);
  }
  const results = new Array<O>(items.length);
  let next = 0;
  const runners = Array(Math.min(limit, items.length))
    .fill(0)
    .map(async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) break;
        results[i] = await worker(items[i], i);
      }
    });
  await Promise.all(runners);
  return results;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Reduce a single group of MiddleSummary[] → partial ReduceLLMResult via LLM (RPS-limited). */
async function reduceGroupToResult(params: {
  instruction: string;
  output_format: string;
  meta: ReturnType<typeof buildMeta>;
  group: MiddleSummary[];
  llm: LLMClient;
  llmOptions?: GenerateOptions;
}): Promise<ReduceLLMResult> {
  const { instruction, output_format, meta, group, llm, llmOptions } = params;
  const messages = buildReduceMessages({
    instruction,
    output_format,
    meta,
    middle_summaries: group
  });

  // RPS gate before the LLM call
  await llmLimiter.acquire();

  const { object } = await llm.generateObject<ReduceLLMResult>(
    messages,
    reduceSchema,
    { temperature: 0.2, ...(llmOptions ?? {}) }
  );
  return object;
}

/** Convert a partial ReduceLLMResult back to a MiddleSummary for the next layer. */
function reduceResultToMiddleSummary(r: ReduceLLMResult): MiddleSummary {
  return {
    based_on_orders: Array.from(new Set(r.summary.based_on_orders ?? [])),
    summary: r.summary.summary ?? ""
  };
}

/**
 * Parallel, tree-structured reduction.
 * - Split into groups of size `groupSize`
 * - Reduce groups in parallel up to `concurrency` (each call RPS-limited)
 * - Convert each partial result to a MiddleSummary
 * - Repeat until one final group remains and reduce it to the final result
 */
async function reduceMiddleSummaries(params: {
  instruction: string;
  output_format: string;
  meta: ReturnType<typeof buildMeta>;
  middleSummaries: MiddleSummary[];
  llm: LLMClient;
  llmOptions?: GenerateOptions;
  groupSize?: number;    // default: 8
  concurrency?: number;  // default: 4
}): Promise<ReduceLLMResult> {
  const {
    instruction, output_format, meta, middleSummaries, llm, llmOptions
  } = params;

  const groupSize =
    Math.max(1, Number(params.groupSize ?? process.env.REDUCE_GROUP_SIZE ?? 8));
  const concurrency =
    Math.max(1, Number(params.concurrency ?? process.env.REDUCE_CONCURRENCY ?? 4));

  if (middleSummaries.length === 0) {
    return {
      summary: { based_on_orders: [], summary: "" },
      soft_summary: { based_on_orders: [], summary: "" }
    };
  }

  if (middleSummaries.length <= groupSize) {
    return reduceGroupToResult({
      instruction, output_format, meta, group: middleSummaries, llm, llmOptions
    });
  }

  let layer: MiddleSummary[] = middleSummaries.slice();
  while (layer.length > groupSize) {
    const groups = chunkArray(layer, groupSize);
    const partials = await mapWithConcurrency(groups, concurrency, async (group) => {
      const result = await reduceGroupToResult({
        instruction, output_format, meta, group, llm, llmOptions
      });
      return reduceResultToMiddleSummary(result);
    });
    layer = partials;
  }

  return reduceGroupToResult({
    instruction, output_format, meta, group: layer, llm, llmOptions
  });
}

// ---------------- Public types ----------------

export interface ChunkLLMResult {
  dialogs?: Array<Pick<Dialog, "order" | "summary" | "soft_language">>;
  middle_summary: MiddleSummary;
  terms?: Term[];
  keywords?: Keyword[];
  participants?: Participant[];
  outline?: string[];
}

export interface ReduceLLMResult {
  summary: Summary;
  soft_summary: SoftSummary;
  title?: string;
  description?: string;
  keywords?: Keyword[];
}

// ---------------- Main (one meeting) ----------------

/** Process ONE meeting with greedy packing (no cutting). */
export async function processMeeting({
  raw,
  instruction,
  output_format,
  charThreshold = 10_000,
  llm,
  llmOptions
}: {
  raw: RawMeetingRecord;
  instruction: string;
  output_format: string;
  charThreshold?: number;   // total chars per chunk (sum of original_text)
  llm: LLMClient;
  llmOptions?: GenerateOptions;
}): Promise<Article> {
  console.debug(`Processing meeting: ${raw.issueID} (${raw.nameOfMeeting})`);
  const meta = buildMeta(raw);
  const dialogs = buildDialogs(raw);

  // Pack dialogs into index sets, then materialize to chunks
  const indexTable = buildOrderLen(dialogs);
  const packs: IndexPack[] = packIndexSetsByGreedy(indexTable, charThreshold);
  const chunks: Dialog[][] = materializeChunks(packs, dialogs);

  // Chunk-level LLM calls in PARALLEL (bounded). Each call is also RPS-limited.
  const chunkConcurrency = Math.max(1, Number(process.env.LLM_CHUNK_CONCURRENCY ?? 4));

  type ChunkAggregate = {
    idx: number;
    dialogs: Dialog[];            // merged per-dialog updates
    middle: MiddleSummary;        // required
    participants?: Participant[];
    terms?: Term[];
    keywords?: Keyword[];
    outline?: string[];
  };

  const chunkResults: ChunkAggregate[] = await mapWithConcurrency(
    chunks,
    chunkConcurrency,
    async (chunk, i) => {
      const messages = buildChunkMessages({
        instruction,
        output_format,
        meta,
        chunkDialogs: chunk,
        chunkIndex: i,
        chunkCount: chunks.length
      });

      // RPS gate before the LLM call
      await llmLimiter.acquire();

      const { object: part } = await llm.generateObject<ChunkLLMResult>(
        messages,
        chunkSchema,
        { temperature: 0.2, ...(llmOptions ?? {}) }
      );

      const mergedDialogs = mergeDialogSummaries(chunk, part.dialogs);
      return {
        idx: i,
        dialogs: mergedDialogs,
        middle: part.middle_summary,
        participants: part.participants,
        terms: part.terms,
        keywords: part.keywords,
        outline: part.outline
      };
    }
  );

  // Deterministic aggregation after all chunk calls have completed
  const allDialogs: Dialog[] = [];
  const allMiddle: MiddleSummary[] = [];
  const participantsMap = new Map<string, string>();
  const termsMap = new Map<string, string>();
  const keywordScore = new Map<string, { score: number; priority: "high"|"medium"|"low" }>();

  for (const r of chunkResults.sort((a,b)=>a.idx-b.idx)) {
    allDialogs.push(...r.dialogs);
    allMiddle.push(r.middle);

    for (const p of (r.participants ?? [])) {
      const key = p.name.replace(/\s+/g, "");
      if (!participantsMap.has(key)) participantsMap.set(key, p.summary);
    }
    for (const t of (r.terms ?? [])) {
      if (!termsMap.has(t.term)) termsMap.set(t.term, t.definition);
    }
    for (const k of (r.keywords ?? [])) {
      const base = k.priority === "high" ? 3 : k.priority === "medium" ? 2 : 1;
      const cur = keywordScore.get(k.keyword);
      keywordScore.set(k.keyword, { score: (cur?.score ?? 0) + base, priority: k.priority });
    }
  }

  // Final reduce using PARALLEL TREE reduction over middle summaries
  const reduced = await reduceMiddleSummaries({
    instruction,
    output_format,
    meta,
    middleSummaries: allMiddle,
    llm,
    llmOptions,
    groupSize: Number(process.env.REDUCE_GROUP_SIZE ?? 8),
    concurrency: Number(process.env.REDUCE_CONCURRENCY ?? 4),
  });

  // Keywords: prefer reduced.keywords; otherwise rank by score
  const rankedKeywords: Keyword[] = reduced.keywords ?? [...keywordScore.entries()]
    .sort((a,b)=> b[1].score - a[1].score)
    .map(([keyword, _v], i) => {
      const priority: "high" | "medium" | "low" = i < 8 ? "high" : i < 20 ? "medium" : "low";
      return { keyword, priority };
    });

  const article: Article = {
    ...meta,
    title: reduced.title ?? meta.title,
    description: reduced.description ?? meta.description,
    dialogs: allDialogs,
    middle_summary: allMiddle,
    summary: reduced.summary,
    soft_summary: reduced.soft_summary,
    participants: [...participantsMap.entries()].map(([name, summary]) => ({ name, summary })),
    keywords: rankedKeywords,
    terms: [...termsMap.entries()].map(([term, definition]) => ({ term, definition }))
  };

  return article;
}

// ---------------- Batch over RawMeetingData (parallel) ----------------

interface ArgsA {
  rawData: RawMeetingData;
  instruction: string;
  output_format: string;
  charThreshold?: number;
  llm: LLMClient;
  llmOptions?: GenerateOptions;
}

// Backward-compat: some callers used { raw, numOfCharChunk }
interface ArgsB {
  raw: RawMeetingData;
  instruction: string;
  output_format: string;
  numOfCharChunk?: number;
  llm: LLMClient;
  llmOptions?: GenerateOptions;
}

export async function processRawMeetingData(args: ArgsA | (ArgsB & { concurrency?: number })): Promise<Article[]> {
  const rawData = "rawData" in args ? args.rawData : args.raw;
  const charThreshold =
    "charThreshold" in args && args.charThreshold != null
      ? args.charThreshold!
      : ("numOfCharChunk" in args && args.numOfCharChunk != null
          ? args.numOfCharChunk!
          : 10_000);

  const { instruction, output_format, llm, llmOptions } = args;

  // Concurrency for per-meeting processing (default 4, override via LLM_CONCURRENCY or args.concurrency)
  const defaultConc = Number(process.env.LLM_CONCURRENCY ?? 4);
  const concurrency = Math.max(1, Number((args as any).concurrency ?? defaultConc));

  const meetings = rawData.meetingRecord;

  // Process meetings in parallel with bounded concurrency; order is preserved
  const articles = await mapWithConcurrency(meetings, concurrency, (rec) =>
    processMeeting({
      raw: rec,
      instruction,
      output_format,
      charThreshold,
      llm,
      llmOptions
    })
  );

  return articles;
}

// (Optional) export schemas if other modules (e.g., tests) need them
export { chunkSchema, reduceSchema, buildReduceMessages };
