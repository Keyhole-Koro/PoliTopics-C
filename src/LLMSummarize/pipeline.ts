// - Build Dialog[] from RawMeetingRecord (order by speechID part / speechOrder)
// - Pack dialogs greedily by charThreshold (sum of original_text length)
// - Per chunk (IN PARALLEL): ask LLM for middle_summary + optional per-dialog summaries/soft_language
// - Final reduce (PARALLEL TREE): consolidate all middle_summaries into final title/summary/soft_summary/categories
// - Batch over RawMeetingData (IN PARALLEL with bounded concurrency)
// - RPS limiter: throttle LLM calls by requests-per-second + burst (token-bucket)

import type {
  Article, Dialog, Keyword, MiddleSummary, Participant, SoftSummary, Summary, Term
} from "@interfaces/Article";
import type { RawMeetingData, RawMeetingRecord, RawSpeechRecord } from "@interfaces/Raw";
import type { LLMClient, Message, GenerateOptions } from "@llm/LLMClient";

import { chunkSchema, reduceSchema } from "./schema";
import {
  buildOrderLen,
  packIndexSetsByGreedy,
  materializeChunks,
  type IndexPack
} from "./packing";

// ---------------- Rate limiter (token-bucket) ----------------

const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

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
  private refill() {
    const now = Date.now();
    const elapsed = Math.max(0, now - this.lastRefillMs);
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
      this.lastRefillMs = now;
    }
  }
  async acquire(): Promise<void> {
    while (true) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const needed = 1 - this.tokens;
      const waitMs = Math.ceil(needed / this.refillPerMs);
      await sleep(Math.max(1, waitMs));
    }
  }
}

const LLM_RPS = Math.max(1, Number(process.env.LLM_RPS ?? 4));
const LLM_BURST = Math.max(1, Number(process.env.LLM_BURST ?? LLM_RPS));
export const llmLimiter = new RpsLimiter(LLM_RPS, LLM_BURST);

// ---------------- Utilities ----------------

function getSpeechNumericOrder(s: RawSpeechRecord, idx: number): number {
  const idPart = s.speechID?.split("_")[1];
  const byId = idPart ? Number(idPart) : NaN;
  if (!Number.isNaN(byId)) return byId;
  if (typeof s.speechOrder === "number" && !Number.isNaN(s.speechOrder)) return s.speechOrder;
  return idx + 1;
}

function sortSpeeches(raw: RawMeetingRecord): RawSpeechRecord[] {
  return [...raw.speechRecord].sort((a, b) => {
    const ao = getSpeechNumericOrder(a, 0);
    const bo = getSpeechNumericOrder(b, 0);
    return ao - bo;
  });
}

function toDialog(s: RawSpeechRecord, order: number): Dialog {
  return {
    order,
    speaker: s.speaker ?? "",
    speaker_group: s.speakerGroup ?? "",
    speaker_position: s.speakerPosition ?? "",
    speaker_role: s.speakerRole ?? "",
    original_text: s.speech ?? "",
    summary: "",
    soft_language: ""
  };
}

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

function buildMeta(raw: RawMeetingRecord): Required<Pick<Article,
  "id"|"date"|"month"|"imageKind"|"session"|"nameOfHouse"|"nameOfMeeting">> {
  const allowed = new Set(["会議録","目次","索引","附録","追録"]);
  const imageKind = allowed.has(raw.imageKind) ? (raw.imageKind as Article["imageKind"]) : "会議録";
  return {
    id: raw.issueID,
    date: raw.date,
    month: raw.date.slice(0, 7), // YYYY-MM
    imageKind,
    session: raw.session,
    nameOfHouse: raw.nameOfHouse,
    nameOfMeeting: raw.nameOfMeeting
  };
}

// ---------------- Prompt builders ----------------

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

/* Also include "categories": an array of high-level topics for THIS CHUNK. */

Dialogs:
${JSON.stringify(chunkDialogs)}
`
  };

  return [system, user];
}

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
      "You consolidate chunk-level middle summaries into final outputs. " +
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

Requirements:
- Produce a concise, informative "title" (headline) for the WHOLE meeting.
- Provide "categories" as an array of high-level topics for the WHOLE meeting (e.g., ["エネルギー", "財政"]).
- Keep summaries faithful to the provided middle summaries.

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

async function mapWithConcurrency<I, O>(
  items: I[],
  limit: number,
  worker: (item: I, index: number) => Promise<O>
): Promise<O[]> {
  if (!Number.isFinite(limit) || limit <= 0) throw new Error(`mapWithConcurrency: invalid limit=${limit}`);
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

// ---------------- Reduce phase ----------------

async function reduceGroupToResult(params: {
  instruction: string;
  output_format: string;
  meta: ReturnType<typeof buildMeta>;
  group: MiddleSummary[];
  llm: LLMClient;
  llmOptions?: GenerateOptions;
}): Promise<ReduceLLMResult> {
  const { instruction, output_format, meta, group, llm, llmOptions } = params;
  const messages = buildReduceMessages({ instruction, output_format, meta, middle_summaries: group });
  await llmLimiter.acquire();
  const { object } = await llm.generateObject<ReduceLLMResult>(
    messages,
    reduceSchema,
    { temperature: 0.2, ...(llmOptions ?? {}) }
  );
  return object;
}

function reduceResultToMiddleSummary(r: ReduceLLMResult): MiddleSummary {
  return {
    based_on_orders: Array.from(new Set(r.summary.based_on_orders ?? [])),
    summary: r.summary.summary ?? ""
  };
}

async function reduceMiddleSummaries(params: {
  instruction: string;
  output_format: string;
  meta: ReturnType<typeof buildMeta>;
  middleSummaries: MiddleSummary[];
  llm: LLMClient;
  llmOptions?: GenerateOptions;
  groupSize?: number;
  concurrency?: number;
}): Promise<ReduceLLMResult> {
  const { instruction, output_format, meta, middleSummaries, llm, llmOptions } = params;

  const groupSize = Math.max(1, Number(params.groupSize ?? process.env.REDUCE_GROUP_SIZE ?? 8));
  const concurrency = Math.max(1, Number(params.concurrency ?? process.env.REDUCE_CONCURRENCY ?? 4));

  if (middleSummaries.length === 0) {
    return {
      title: "",
      categories: [],
      summary: { based_on_orders: [], summary: "" },
      soft_summary: { based_on_orders: [], summary: "" },
      description: "",
      keywords: []
    };
  }

  if (middleSummaries.length <= groupSize) {
    return reduceGroupToResult({ instruction, output_format, meta, group: middleSummaries, llm, llmOptions });
  }

  let layer: MiddleSummary[] = middleSummaries.slice();
  while (layer.length > groupSize) {
    const groups = chunkArray(layer, groupSize);
    const partials = await mapWithConcurrency(groups, concurrency, async (group) => {
      const result = await reduceGroupToResult({ instruction, output_format, meta, group, llm, llmOptions });
      return reduceResultToMiddleSummary(result);
    });
    layer = partials;
  }

  return reduceGroupToResult({ instruction, output_format, meta, group: layer, llm, llmOptions });
}

// ---------------- Public types ----------------

export interface ChunkLLMResult {
  categories: string[];
  dialogs?: Array<Pick<Dialog, "order" | "summary" | "soft_language">>;
  middle_summary: MiddleSummary;
  terms?: Term[];
  keywords?: Keyword[];
  participants?: Participant[];
  outline?: string[];
}

export interface ReduceLLMResult {
  title: string;
  categories: string[];
  summary: Summary;
  soft_summary: SoftSummary;
  description?: string;
  keywords?: Keyword[];
}

// ---------------- Main (one meeting) ----------------

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
  charThreshold?: number;
  llm: LLMClient;
  llmOptions?: GenerateOptions;
}): Promise<Article> {
  console.debug(`Processing meeting: ${raw.issueID} (${raw.nameOfMeeting})`);
  const meta = buildMeta(raw);
  const dialogs = buildDialogs(raw);

  const indexTable = buildOrderLen(dialogs);
  const packs: IndexPack[] = packIndexSetsByGreedy(indexTable, charThreshold);
  const chunks: Dialog[][] = materializeChunks(packs, dialogs);

  const chunkConcurrency = Math.max(1, Number(process.env.LLM_CHUNK_CONCURRENCY ?? 4));

  type ChunkAggregate = {
    idx: number;
    categories: string[];
    dialogs: Dialog[];
    middle: MiddleSummary;
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

      await llmLimiter.acquire();

      console.log(`Processing chunk ${i + 1}/${chunks.length} (${chunk.length} dialogs)`);
      const { object: part } = await llm.generateObject<ChunkLLMResult>(
        messages,
        chunkSchema,
        { temperature: 0.2, ...(llmOptions ?? {}) }
      );

      const mergedDialogs = mergeDialogSummaries(chunk, part.dialogs);
      return {
        idx: i,
        categories: Array.isArray(part.categories) ? part.categories : [],
        dialogs: mergedDialogs,
        middle: part.middle_summary,
        participants: part.participants,
        terms: part.terms,
        keywords: part.keywords,
        outline: part.outline
      };
    }
  );

  // Deterministic aggregation
  const allDialogs: Dialog[] = [];
  const allMiddle: MiddleSummary[] = [];
  const participantsMap = new Map<string, string>();
  const termsMap = new Map<string, string>();
  const keywordScore = new Map<string, { score: number; priority: "high"|"medium"|"low" }>();
  const categoryCount = new Map<string, number>();

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

    for (const c of (r.categories ?? [])) {
      const cat = String(c || "").trim();
      if (!cat) continue;
      categoryCount.set(cat, (categoryCount.get(cat) ?? 0) + 1);
    }
  }

  // Final reduce
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

  // Pick top-2 categories by frequency across chunks (stable tie-breaker by name)
  const topCategories: string[] = Array.from(categoryCount.entries())
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, 2)
    .map(([cat]) => cat);

  // Keywords: prefer reduced.keywords; otherwise rank by score
  const rankedKeywords: Keyword[] = (reduced.keywords && reduced.keywords.length)
    ? reduced.keywords
    : [...keywordScore.entries()]
        .sort((a,b)=> b[1].score - a[1].score)
        .map(([keyword, _v], i) => {
          const priority: "high" | "medium" | "low" = i < 8 ? "high" : i < 20 ? "medium" : "low";
          return { keyword, priority };
        });

  const fallbackTitle = `${meta.nameOfMeeting}（${meta.date}）`;

  const article: Article = {
    ...meta,
    title: reduced.title || fallbackTitle,
    description: reduced.description ?? "",
    dialogs: allDialogs,
    middle_summary: allMiddle,
    summary: reduced.summary,
    soft_summary: reduced.soft_summary,
    participants: [...participantsMap.entries()].map(([name, summary]) => ({ name, summary })),
    keywords: rankedKeywords,
    terms: [...termsMap.entries()].map(([term, definition]) => ({ term, definition })),
    categories: topCategories   // <= only the 1st and 2nd most frequent
  };

  return article;
}

// ---------------- Batch over RawMeetingData ----------------

interface ArgsA {
  rawData: RawMeetingData;
  instruction: string;
  output_format: string;
  charThreshold?: number;
  llm: LLMClient;
  llmOptions?: GenerateOptions;
}
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

  const defaultConc = Number(process.env.LLM_CONCURRENCY ?? 4);
  const concurrency = Math.max(1, Number((args as any).concurrency ?? defaultConc));

  const meetings = rawData.meetingRecord;

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
