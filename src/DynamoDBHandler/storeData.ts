// dynamo.ts
// DynamoDB single-table pattern for Articles + thin indexes
//
// - Main item:
//     PK = "A#<id>", SK = "META"
//     Holds all large fields (dialogs, summaries, etc.). Only one item per article.
// - Thin index items (for fast listing by facets):
//     PK in { CATEGORY#<category>, PERSON#<name>, KEYWORD#<kw>,
//             IMAGEKIND#<kind>, SESSION#<zero-padded>, HOUSE#<house>, MEETING#<meeting> }
//     SK = "Y#<YYYY>#M#<MM>#D#<ISO date>#A#<id>"
//     Example: "Y#2025#M#08#D#2025-08-20T12:34:56Z#A#a1"
//     This allows begins_with() filters by year and year+month.
// - Optional "recent keyword" log (for trending views):
//     PK = "KEYWORD_RECENT"
//     SK = "D#<ISO date>#KW#<keyword>#A#<id>"
// - GSIs:
//     ArticleByDate  (GSI1PK="ARTICLE",     GSI1SK=<ISO date>)   -- all articles by date
//     MonthDateIndex (GSI2PK="MONTH#YYYY-MM", GSI2SK=<ISO date>) -- per-month articles by date
//
// Tips:
// - Initialize DynamoDBDocumentClient with marshallOptions: { removeUndefinedValues: true }.
// - Store date as ISO UTC strings so lexicographic order == chronological order.

import {
  DynamoDBDocumentClient,
  PutCommand,
  BatchWriteCommand,
  QueryCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";

// ---- Minimal self-contained types (replace with your actual interfaces if available) ----
export type Summary = unknown;
export type SoftSummary = unknown;
export type MiddleSummary = unknown;
export type Dialog = { speaker?: string; text?: string };
export type Participant = { name?: string };
export type Keyword = { keyword?: string };
export type Term = { term?: string };

export interface Article {
  id: string;
  title: string;
  date: string;  // ISO string, e.g. "2025-08-20T12:34:56Z"
  month: string; // "YYYY-MM"
  imageKind: "会議録" | "目次" | "索引" | "附録" | "追録";
  session: number;
  nameOfHouse: string;
  nameOfMeeting: string;
  categories: string[];
  description: string;

  summary: Summary;
  soft_summary: SoftSummary;
  middle_summary: MiddleSummary[];
  dialogs: Dialog[];
  participants: Participant[];
  keywords: Keyword[];
  terms: Term[];
}

export type Cfg = {
  doc: DynamoDBDocumentClient;
  table_name: string; // single table name
};

// ---- Key helpers --------------------------------------------------------
const artPK = (id: string) => `A#${id}`;
const artSK = "META";

// Consider normalizing PERSON/KEYWORD via yomi/slug in production
const catKey = (c: string) => `CATEGORY#${c}`;
const personKey = (p: string) => `PERSON#${p}`;
const kwKey = (k: string) => `KEYWORD#${k}`;
const kindKey = (k: string) => `IMAGEKIND#${k}`;
const sessionKey = (s: number | string) => `SESSION#${String(s).padStart(4, "0")}`;
const houseKey = (h: string) => `HOUSE#${h}`;
const meetingKey = (m: string) => `MEETING#${m}`;

// ---- Validators / formatters --------------------------------------------
function ensureYYYYMM(v: string) {
  if (!/^\d{4}-\d{2}$/.test(v)) throw new Error(`month must be 'YYYY-MM', got: ${v}`);
  return v;
}
function yOf(monthYYYYMM: string) { return ensureYYYYMM(monthYYYYMM).slice(0, 4); }
function mOf(monthYYYYMM: string) { return ensureYYYYMM(monthYYYYMM).slice(5, 7); }

// Compose the thin-index SK as "Y#YYYY#M#MM#D#<ISO>#A#<id>"
const idxSK = (monthYYYYMM: string, isoDate: string, id: string) =>
  `Y#${yOf(monthYYYYMM)}#M#${mOf(monthYYYYMM)}#D#${isoDate}#A#${id}`;

// Optional: convert "8" or "08" to "YYYY-08" (defaulting to the current UTC year)
export function toYYYYMM(monthLike: string, baseDate = new Date()): string {
  const m = monthLike.padStart(2, "0").slice(-2);
  const y = String(baseDate.getUTCFullYear());
  return `${y}-${m}`;
}

export function lastNDaysRange(n: number, now = new Date()) {
  const end = now.toISOString();
  const start = new Date(now.getTime() - n * 86_400_000).toISOString();
  return { start, end };
}

// ---- BatchWrite helper (max 25 items per request, with simple retry) ----
async function batchPutAll(
  doc: DynamoDBDocumentClient,
  table: string,
  items: any[]
) {
  let i = 0;
  while (i < items.length) {
    const slice = items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } }));
    const res = await doc.send(
      new BatchWriteCommand({ RequestItems: { [table]: slice } })
    );

    const unp = res.UnprocessedItems?.[table] ?? [];
    if (unp.length > 0) {
      // naive backoff + requeue unprocessed items in the current window
      await new Promise((r) => setTimeout(r, 200));
      const retryItems = unp.map((u) => u.PutRequest!.Item);
      items.splice(i, 0, ...retryItems);
    } else {
      i += 25;
    }
  }
}

// ---- Store: main item + thin index items --------------------------------
export default async function storeData(
  config: Cfg,
  article: Article
): Promise<{ ok: boolean; id: string }> {
  const { doc, table_name: TableName } = config;

  // Main item (keep heavy attributes ONLY here)
  const mainItem = {
    ...article, // spread first to allow overrides below
    PK: artPK(article.id),
    SK: artSK,
    type: "ARTICLE",

    // GSIs for global listings
    GSI1PK: "ARTICLE",
    GSI1SK: article.date,
    GSI2PK: `MONTH#${article.month}`,
    GSI2SK: article.date,
  };

  await doc.send(new PutCommand({ TableName, Item: mainItem }));

  // Thin index items (only minimal fields used for list views)
  const thinBase = {
    type: "THIN_INDEX",
    articleId: article.id,
    title: article.title,
    date: article.date,
    month: article.month,
    imageKind: article.imageKind,
    nameOfMeeting: article.nameOfMeeting,
    session: article.session,
    nameOfHouse: article.nameOfHouse,
    // Avoid duplicating arrays/large fields here to keep costs low.
    // Add description if your list UI needs it (trade-off: storage + write cost).
    // description: article.description,
  };

  const sk = idxSK(article.month, article.date, article.id);
  const idxItems: any[] = [];

  // Category indexes
  for (const c of article.categories ?? []) {
    const cat = (c ?? "").trim();
    if (!cat) continue;
    idxItems.push({
      PK: catKey(cat),
      SK: sk,
      kind: "CATEGORY_INDEX",
      ...thinBase,
    });
  }

  // Person indexes
  for (const p of article.participants ?? []) {
    const name = (p?.name ?? "").trim();
    if (!name) continue;
    idxItems.push({
      PK: personKey(name),
      SK: sk,
      kind: "PERSON_INDEX",
      ...thinBase,
    });
  }

  // Keyword indexes + optional recent keyword occurrence log
  for (const k of article.keywords ?? []) {
    const kw = (k?.keyword ?? "").trim();
    if (!kw) continue;
    idxItems.push({
      PK: kwKey(kw),
      SK: sk,
      kind: "KEYWORD_INDEX",
      ...thinBase,
    });

    // Optional: recent keyword occurrence (for "trending keywords" views)
    idxItems.push({
      PK: "KEYWORD_RECENT",
      SK: `D#${article.date}#KW#${kw}#A#${article.id}`,
      kind: "KEYWORD_OCCURRENCE",
      keyword: kw,
      articleId: article.id,
      title: article.title,
      date: article.date,
      month: article.month,
    });
  }

  // Other facet indexes
  idxItems.push({
    PK: kindKey(article.imageKind),
    SK: sk,
    kind: "IMAGEKIND_INDEX",
    ...thinBase,
  });

  idxItems.push({
    PK: sessionKey(article.session),
    SK: sk,
    kind: "SESSION_INDEX",
    ...thinBase,
  });

  if (article.nameOfHouse?.trim()) {
    idxItems.push({
      PK: houseKey(article.nameOfHouse.trim()),
      SK: sk,
      kind: "HOUSE_INDEX",
      ...thinBase,
    });
  }

  if (article.nameOfMeeting?.trim()) {
    idxItems.push({
      PK: meetingKey(article.nameOfMeeting.trim()),
      SK: sk,
      kind: "MEETING_INDEX",
      ...thinBase,
    });
  }

  if (idxItems.length) {
    await batchPutAll(doc, TableName, idxItems);
  }

  return { ok: true, id: article.id };
}

// ---- Get main article ---------------------------------------------------
export async function getArticleById(cfg: Cfg, id: string) {
  return cfg.doc.send(
    new GetCommand({
      TableName: cfg.table_name,
      Key: { PK: artPK(id), SK: artSK },
    })
  );
}

// ---- Query helpers (per-facet) -----------------------------------------
type QueryOpts = { limit?: number; startKey?: any };

const qByPk = (cfg: Cfg, pk: string, opts?: QueryOpts) =>
  cfg.doc.send(
    new QueryCommand({
      TableName: cfg.table_name,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": pk },
      ScanIndexForward: false, // newest first
      Limit: opts?.limit ?? 20,
      ExclusiveStartKey: opts?.startKey,
    })
  );

export const listByCategory = (cfg: Cfg, category: string, opts?: QueryOpts) =>
  qByPk(cfg, catKey(category), opts);

export const listByPerson = (cfg: Cfg, person: string, opts?: QueryOpts) =>
  qByPk(cfg, personKey(person), opts);

export const listByKeyword = (cfg: Cfg, kw: string, opts?: QueryOpts) =>
  qByPk(cfg, kwKey(kw), opts);

export const listByImageKind = (cfg: Cfg, kind: string, opts?: QueryOpts) =>
  qByPk(cfg, kindKey(kind), opts);

export const listBySession = (cfg: Cfg, s: number | string, opts?: QueryOpts) =>
  qByPk(cfg, sessionKey(s), opts);

export const listByHouse = (cfg: Cfg, h: string, opts?: QueryOpts) =>
  qByPk(cfg, houseKey(h), opts);

export const listByMeeting = (cfg: Cfg, m: string, opts?: QueryOpts) =>
  qByPk(cfg, meetingKey(m), opts);

// ---- Year / Year+Month prefix filters on SK -----------------------------
// Year-only filter (e.g., "Y#2025#...")
export const listByPkAndYear = (
  cfg: Cfg,
  pk: string,
  year: number | string,
  opts?: { limit?: number }
) =>
  cfg.doc.send(
    new QueryCommand({
      TableName: cfg.table_name,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :pref)",
      ExpressionAttributeValues: {
        ":pk": pk,
        ":pref": `Y#${String(year).padStart(4, "0")}#`,
      },
      ScanIndexForward: false,
      Limit: opts?.limit ?? 50,
    })
  );

// Year+Month filter using 'YYYY-MM' input
export const listByPkAndMonth = (
  cfg: Cfg,
  pk: string,
  monthYYYYMM: string,
  opts?: { limit?: number }
) => {
  const y = yOf(monthYYYYMM);
  const m = mOf(monthYYYYMM);
  return cfg.doc.send(
    new QueryCommand({
      TableName: cfg.table_name,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :pref)",
      ExpressionAttributeValues: {
        ":pk": pk,
        ":pref": `Y#${y}#M#${m}`,
      },
      ScanIndexForward: false,
      Limit: opts?.limit ?? 50,
    })
  );
};

export const listByCategoryAndYear = (
  cfg: Cfg,
  category: string,
  year: number | string,
  opts?: { limit?: number }
) => listByPkAndYear(cfg, catKey(category), year, opts);

export const listByPersonAndYear = (
  cfg: Cfg,
  person: string,
  year: number | string,
  opts?: { limit?: number }
) => listByPkAndYear(cfg, personKey(person), year, opts);

export const listByKeywordAndYear = (
  cfg: Cfg,
  kw: string,
  year: number | string,
  opts?: { limit?: number }
) => listByPkAndYear(cfg, kwKey(kw), year, opts);

export const listByCategoryAndMonth = (
  cfg: Cfg,
  category: string,
  monthYYYYMM: string,
  opts?: { limit?: number }
) => listByPkAndMonth(cfg, catKey(category), monthYYYYMM, opts);

export const listByPersonAndMonth = (
  cfg: Cfg,
  person: string,
  monthYYYYMM: string,
  opts?: { limit?: number }
) => listByPkAndMonth(cfg, personKey(person), monthYYYYMM, opts);

export const listByKeywordAndMonth = (
  cfg: Cfg,
  kw: string,
  monthYYYYMM: string,
  opts?: { limit?: number }
) => listByPkAndMonth(cfg, kwKey(kw), monthYYYYMM, opts);

// ---- Global listings via GSIs ------------------------------------------
export const listRecentArticles = (cfg: Cfg, opts?: QueryOpts) =>
  cfg.doc.send(
    new QueryCommand({
      TableName: cfg.table_name,
      IndexName: "ArticleByDate",
      KeyConditionExpression: "GSI1PK = :p",
      ExpressionAttributeValues: { ":p": "ARTICLE" },
      ScanIndexForward: false,
      Limit: opts?.limit ?? 20,
      ExclusiveStartKey: opts?.startKey,
    })
  );

export const listMonth = (cfg: Cfg, monthYYYYMM: string, opts?: QueryOpts) =>
  cfg.doc.send(
    new QueryCommand({
      TableName: cfg.table_name,
      IndexName: "MonthDateIndex",
      KeyConditionExpression: "GSI2PK = :p",
      ExpressionAttributeValues: { ":p": `MONTH#${ensureYYYYMM(monthYYYYMM)}` },
      ScanIndexForward: false,
      Limit: opts?.limit ?? 50,
      ExclusiveStartKey: opts?.startKey,
    })
  );

// Year-range on all articles via GSI1 (e.g., 2025-01-01..2026-01-01)
export const listYearAll = (cfg: Cfg, year: number | string, opts?: QueryOpts) => {
  const y = String(year).padStart(4, "0");
  const start = `${y}-01-01T00:00:00Z`;
  const end   = `${String(Number(y) + 1).padStart(4, "0")}-01-01T00:00:00Z`;
  return cfg.doc.send(
    new QueryCommand({
      TableName: cfg.table_name,
      IndexName: "ArticleByDate",
      KeyConditionExpression: "GSI1PK = :p AND GSI1SK BETWEEN :s AND :e",
      ExpressionAttributeValues: { ":p": "ARTICLE", ":s": start, ":e": end },
      ScanIndexForward: false,
      Limit: opts?.limit ?? 50,
      ExclusiveStartKey: opts?.startKey,
    })
  );
};

// ---- Keyword "recent" occurrence log ------------------------------------
export const listRecentKeywordOccurrences = (cfg: Cfg, opts?: QueryOpts) =>
  cfg.doc.send(
    new QueryCommand({
      TableName: cfg.table_name,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": "KEYWORD_RECENT" },
      ScanIndexForward: false,
      Limit: opts?.limit ?? 100,
      ExclusiveStartKey: opts?.startKey,
    })
  );

export const listRecentKeywordOccurrencesInRange = (
  cfg: Cfg,
  startISO: string,
  endISO: string,
  opts?: QueryOpts
) =>
  cfg.doc.send(
    new QueryCommand({
      TableName: cfg.table_name,
      KeyConditionExpression: "PK = :p AND SK BETWEEN :s AND :e",
      ExpressionAttributeValues: {
        ":p": "KEYWORD_RECENT",
        ":s": `D#${startISO}`,
        ":e": `D#${endISO}`,
      },
      ScanIndexForward: false,
      Limit: opts?.limit ?? 100,
      ExclusiveStartKey: opts?.startKey,
    })
  );

// Deduplicate to get N distinct recent keywords (no time range)
export async function listRecentDistinctKeywords(cfg: Cfg, limit = 20) {
  const seen = new Set<string>();
  const out: Array<{ keyword: string; lastSeen: string }> = [];
  let startKey: any | undefined = undefined;

  while (out.length < limit) {
    const page = await listRecentKeywordOccurrences(cfg, { limit: 100, startKey });
    for (const it of page.Items ?? []) {
      const kw = String(it.keyword);
      if (!seen.has(kw)) {
        seen.add(kw);
        out.push({ keyword: kw, lastSeen: String(it.date) });
        if (out.length >= limit) break;
      }
    }
    if (!page.LastEvaluatedKey) break;
    startKey = page.LastEvaluatedKey;
  }
  return out;
}

// Deduplicate recent keywords within last N days
export async function listRecentDistinctKeywordsLastNDays(cfg: Cfg, n = 30, limit = 20) {
  const { start, end } = lastNDaysRange(n);
  const seen = new Set<string>();
  const out: Array<{ keyword: string; lastSeen: string }> = [];
  let startKey: any | undefined = undefined;

  while (out.length < limit) {
    const page = await listRecentKeywordOccurrencesInRange(cfg, start, end, { limit: 100, startKey });
    for (const it of page.Items ?? []) {
      const kw = String(it.keyword);
      if (!seen.has(kw)) {
        seen.add(kw);
        out.push({ keyword: kw, lastSeen: String(it.date) });
        if (out.length >= limit) break;
      }
    }
    if (!page.LastEvaluatedKey) break;
    startKey = page.LastEvaluatedKey;
  }
  return out;
}

// ---- Unified search (simple exact-match routing across facets) ----------
export async function unifiedSearch(cfg: Cfg, q: string, limit = 20) {
  const s = q.trim();
  const [cat, person, kw, meeting, house] = await Promise.all([
    listByCategory(cfg, s, { limit }),
    listByPerson(cfg, s, { limit }),
    listByKeyword(cfg, s, { limit }),
    listByMeeting(cfg, s, { limit }),
    listByHouse(cfg, s, { limit }),
  ]);

  if ((cat.Items?.length ?? 0) > 0) return { mode: "category", ...cat };
  if ((person.Items?.length ?? 0) > 0) return { mode: "person", ...person };
  if ((kw.Items?.length ?? 0) > 0) return { mode: "keyword", ...kw };
  if ((meeting.Items?.length ?? 0) > 0) return { mode: "meeting", ...meeting };
  if ((house.Items?.length ?? 0) > 0) return { mode: "house", ...house };

  // Fallback: latest articles globally
  const recent = await listRecentArticles(cfg, { limit });
  return { mode: "recent-fallback", ...recent };
}
