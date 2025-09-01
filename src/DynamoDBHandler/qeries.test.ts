import {
  DynamoDBDocumentClient,
  PutCommand,
  BatchWriteCommand,
  QueryCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";

export type Cfg = {
  doc: DynamoDBDocumentClient;
  table_name: string; // single table name
};

// ---- Key helpers --------------------------------------------------------
const artPK = (id: string) => `A#${id}`;
const artSK = "META";

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

  // Consider normalizing PERSON/KEYWORD via yomi/slug in production
const catKey = (c: string) => `CATEGORY#${c}`;
const personKey = (p: string) => `PERSON#${p}`;
const kwKey = (k: string) => `KEYWORD#${k}`;
const kindKey = (k: string) => `IMAGEKIND#${k}`;
const sessionKey = (s: number | string) => `SESSION#${String(s).padStart(4, "0")}`;
const houseKey = (h: string) => `HOUSE#${h}`;
const meetingKey = (m: string) => `MEETING#${m}`;


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

// ---- Validators / formatters --------------------------------------------
function ensureYYYYMM(v: string) {
  if (!/^\d{4}-\d{2}$/.test(v)) throw new Error(`month must be 'YYYY-MM', got: ${v}`);
  return v;
}
function yOf(monthYYYYMM: string) { return ensureYYYYMM(monthYYYYMM).slice(0, 4); }
function mOf(monthYYYYMM: string) { return ensureYYYYMM(monthYYYYMM).slice(5, 7); }

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

export function lastNDaysRange(n: number, now = new Date()) {
  const end = now.toISOString();
  const start = new Date(now.getTime() - n * 86_400_000).toISOString();
  return { start, end };
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