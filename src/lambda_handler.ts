import { Handler, ScheduledEvent } from 'aws-lambda';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

import fetchNationalDietRecords from '@NationalDietAPIHandler/NationalDietAPIHandler';
import LLMSummarize from '@LLMSummarize/LLMSummarize';
import storeData from '@DynamoDBHandler/storeData';

import { RawMeetingData } from '@NationalDietAPIHandler/RawData';
import { gatherSpeechesById } from '@NationalDietAPIHandler/formatRecord';

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import crypto from "node:crypto";
import 'dotenv/config';

/**
 * Read an environment variable (with optional fallback) or throw if missing.
 */
function getEnvVar(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

// AWS SDK setup (supports LocalStack via AWS_ENDPOINT_URL)
const region = process.env.AWS_REGION || "ap-northeast-3";
const endpoint = process.env.AWS_ENDPOINT_URL;
const s3 = new S3Client({ region, ...(endpoint ? { endpoint } : {}) });

// ---- helpers ---------------------------------------------------

/**
 * Concurrency limit for summarization/storage tasks.
 * Default: 4 (override with CONCURRENCY env var)
 */
const CONCURRENCY = Number(process.env.CONCURRENCY || 4);

type TaskOk = { ok: true; baseId: string; articleId?: string };
type TaskNg = { ok: false; baseId: string; error: { message: string; stack?: string } };
type TaskResult = TaskOk | TaskNg;

/**
 * Normalize unknown errors to a serializable shape.
 */
function serializeError(e: unknown) {
  if (e instanceof Error) return { message: e.message, stack: e.stack };
  return { message: String(e) };
}

/**
 * Run async tasks with a maximum concurrency limit.
 */
async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let next = 0;
  const workers = Array(Math.min(limit, tasks.length))
    .fill(0)
    .map(async () => {
      while (true) {
        const i = next++;
        if (i >= tasks.length) break;
        results[i] = await tasks[i]();
      }
    });
  await Promise.all(workers);
  return results;
}

/**
 * Write a JSON log to S3 under success/ or error/.
 * No-op if ERROR_BUCKET is not configured.
 */
async function logToS3(kind: "error" | "success", payload: any) {
  const bucket = process.env.ERROR_BUCKET;
  if (!bucket) return;
  const key = `${kind}/${new Date().toISOString()}-${crypto.randomUUID()}.json`;
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: JSON.stringify(payload, null, 2),
        ContentType: "application/json",
      })
    );
    console.error(`[LOG] Wrote ${kind} log to s3://${bucket}/${key}`);
  } catch (e) {
    console.error(`[LOG] Failed to write ${kind} log to S3:`, e);
  }
}

/**
 * Return YYYY-MM-DD string in JST with an optional day offset.
 * Example: dateStrJST(0) -> today (JST), dateStrJST(-1) -> previous day (JST).
 */
function dateStrJST(offsetDays = 0): string {
  const tz = 'Asia/Tokyo';
  const fmt = new Intl.DateTimeFormat('ja-JP', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  // Get Y/M/D of "today" in JST
  const now = new Date();
  const nowParts = fmt.formatToParts(now);
  const Y = Number(nowParts.find(p => p.type === 'year')!.value);
  const M = Number(nowParts.find(p => p.type === 'month')!.value);
  const D = Number(nowParts.find(p => p.type === 'day')!.value);

  // Construct UTC timestamp for JST midnight, then apply day offset
  const jstMidnightUtcMs = Date.UTC(Y, M - 1, D) - 9 * 60 * 60 * 1000;
  const target = new Date(jstMidnightUtcMs + offsetDays * 24 * 60 * 60 * 1000);

  const parts = fmt.formatToParts(target);
  const y = parts.find(p => p.type === 'year')!.value;
  const m = parts.find(p => p.type === 'month')!.value;
  const d = parts.find(p => p.type === 'day')!.value;
  return `${y}-${m}-${d}`; // e.g. 2025-08-12
}

// ---------- HTTP helpers ---------------------------------------

type AnyEvent = APIGatewayProxyEventV2 | ScheduledEvent;

const isHttpApiEvent = (e: AnyEvent): e is APIGatewayProxyEventV2 =>
  !!(e as APIGatewayProxyEventV2)?.requestContext?.http?.method;

const json = (statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const lowercaseHeaders = (headers?: Record<string, string | undefined>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v ?? '')]),
  );

const parseYmdOrNull = (v?: unknown): string | null => {
  if (v == null) return null;
  const s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : s;
};

// ---------- core pipeline (shared by HTTP / EventBridge) --------

type PipelinePayload = {
  runId: string;
  startedAt: string;
  finishedAt: string;
  groups: number;
  stored: number;
  failed: number;
  storedIds: string[];
  failures: TaskNg[];
  filters: { from: string; until: string };
  eventSource: string;
  concurrency: number;
};

async function executePipeline(
  fromYmd: string,
  untilYmd: string,
  eventSource: string,
  runId: string,
  startedAt: string
): Promise<PipelinePayload | { message: string; runId: string; filters: { from: string; until: string } }> {
  const API_ENDPOINT = getEnvVar("NATIONAL_DIET_API_ENDPOINT");
  const GEMINI_API_KEY = getEnvVar("GEMINI_API_KEY");

  // 1) Fetch
  const raw: RawMeetingData = await fetchNationalDietRecords(API_ENDPOINT, { from: fromYmd, until: untilYmd });

  if (raw.numberOfRecords && raw.numberOfRecords === 0) {
    const payload = {
      message: 'No records found for the specified date range.',
      runId,
      filters: { from: fromYmd, until: untilYmd },
    };
    // Optional: you can still log "success" with zero records
    await logToS3("success", {
      runId, startedAt, finishedAt: new Date().toISOString(),
      groups: 0, stored: 0, failed: 0, storedIds: [],
      raw: raw,
      failures: [], filters: { from: fromYmd, until: untilYmd },
      eventSource, concurrency: CONCURRENCY
    });
    return payload;
  }

  // 2) Group speeches by baseId
  const mapById = gatherSpeechesById(raw as any);
  const entries = Object.entries(mapById as Record<string, { meetingInfo: any; speeches: any }>);
  console.log(`[${runId}] groups=${entries.length}`);

  // 3) Parallel summarize + store
  const tasks: Array<() => Promise<TaskResult>> = entries.map(([baseId, bundle]) => {
    return async () => {
      const mappedIssue = { baseId, meetingInfo: bundle.meetingInfo, speeches: bundle.speeches };
      try {
        console.log(`[${runId}] -> ${baseId} summarizing...`);
        const article = await LLMSummarize(mappedIssue, GEMINI_API_KEY);

        console.log(`[${runId}] -> ${baseId} storing... id=${article?.id}`);
        await storeData(article);

        console.log(`[${runId}] -> ${baseId} done.`);
        return { ok: true, baseId, articleId: article?.id } as TaskOk;
      } catch (e) {
        const err = serializeError(e);
        console.error(`[${runId}] !! ${baseId} failed: ${err.message}`);
        return { ok: false, baseId, error: err } as TaskNg;
      }
    };
  });

  const results = await runWithConcurrency(tasks, CONCURRENCY);
  const ok = results.filter(r => r.ok) as TaskOk[];
  const ng = results.filter(r => !r.ok) as TaskNg[];

  const storedIds = ok.map(r => r.articleId!).filter(Boolean);
  const finishedAt = new Date().toISOString();

  const payload: PipelinePayload = {
    runId,
    startedAt,
    finishedAt,
    groups: entries.length,
    stored: ok.length,
    failed: ng.length,
    storedIds,
    failures: ng,
    filters: { from: fromYmd, until: untilYmd },
    eventSource,
    concurrency: CONCURRENCY,
  };

  await logToS3("success", payload);
  return payload;
}

// ----------------------------------------------------------------

/**
 * Lambda entrypoint:
 * - If invoked via API Gateway (HTTP API v2): validate x-api-key, parse {from, until}, run pipeline and return JSON.
 * - If invoked via EventBridge (cron): keep existing behavior (defaults to previous day in JST).
 */
export const handler: Handler = async (event: AnyEvent) => {
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  try {
    // ===== HTTP API path =====
    if (isHttpApiEvent(event)) {
      console.log(`[${runId}] HTTP API request: ${event.requestContext.http.method} ${event.requestContext.http.path}`);
      const method = event.requestContext.http.method;
      const headers = lowercaseHeaders(event.headers);

      // 1) API key validation
      const expectedKey = process.env.RUN_API_KEY;
      const providedKey = headers['x-api-key'];
      if (!expectedKey) {
        return json(500, { error: 'server_misconfigured', message: 'RUN_API_KEY is not set' });
      }
      if (providedKey !== expectedKey) {
        return json(401, { error: 'unauthorized' });
      }

      // 2) Input parsing (POST JSON or GET query)
      let from: string | null = null;
      let until: string | null = null;
      if (method === 'POST') {
        let body: any = {};
        if (event.body) {
          const raw = event.isBase64Encoded
            ? Buffer.from(event.body, 'base64').toString('utf8')
            : event.body;
          try { body = JSON.parse(raw); } catch { return json(400, { error: 'invalid_json' }); }
        }
        console.log(body);
        from = parseYmdOrNull(body?.from);
        until = parseYmdOrNull(body?.until);
      } else {
        from = parseYmdOrNull(event.queryStringParameters?.from);
        until = parseYmdOrNull(event.queryStringParameters?.until);
      }

      // Defaults: if missing, run for "today" in JST
      const today = dateStrJST(0);
      const FROM = from ?? today;
      const UNTIL = until ?? FROM;

      // Validate range
      if (FROM > UNTIL) return json(400, { error: 'from must be <= until' });

      const maxDays = Number(process.env.RUN_MAX_RANGE_DAYS ?? '31');
      if (Number.isFinite(maxDays) && maxDays > 0) {
        const startDate = new Date(`${FROM}T00:00:00Z`);
        const endDate = new Date(`${UNTIL}T00:00:00Z`);
        const diffDays = Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;
        if (diffDays > maxDays) {
          return json(400, { error: 'range_too_large', maxDays });
        }
      }

      // 3) Execute pipeline
      const payload = await executePipeline(FROM, UNTIL, 'apigw', runId, startedAt);
      return json(200, { message: 'Event processed (on-demand).', ...payload });
    }

    // ===== EventBridge (cron) path — original behavior =====
    const defaultDate = dateStrJST(-1);
    const FROM = (process.env.FROM_DATE && process.env.FROM_DATE.trim()) || defaultDate;
    const UNTIL = (process.env.UNTIL_DATE && process.env.UNTIL_DATE.trim()) || defaultDate;

    const payload = await executePipeline(FROM, UNTIL, (event as ScheduledEvent)?.source ?? 'manual/local', runId, startedAt);
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Event processed (parallel).', ...payload }),
    };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const err = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };

    const errorPayload = {
      runId,
      startedAt,
      finishedAt,
      error: err,
      eventSource: isHttpApiEvent(event) ? 'apigw' : ((event as any)?.source ?? 'manual/local'),
    };

    console.error('[ERROR] Error processing event:', error);
    await logToS3("error", errorPayload);

    if (isHttpApiEvent(event)) {
      return json(500, { message: 'Internal Server Error', error: err.message, runId });
    }
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Internal Server Error', error: err.message, runId }),
    };
  }
};
