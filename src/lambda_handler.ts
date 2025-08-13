import { Handler, ScheduledEvent } from 'aws-lambda';

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
  if (!v) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
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
 *
 * Implementation detail:
 *  - Build a UTC timestamp that represents JST midnight for "today",
 *    then add offsetDays in 24h increments, and format again in JST.
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

// ----------------------------------------------------------------

/**
 * Lambda entrypoint:
 * 1) Fetch raw records from the National Diet API (filtered by date range)
 * 2) Group speeches by baseId
 * 3) Summarize via LLM (Gemini) and store results to DynamoDB
 * 4) Log execution metadata (and failures) to S3
 *
 * Date filters:
 *  - If FROM_DATE/UNTIL_DATE are not provided, both default to "previous day (JST)".
 */
export const handler: Handler = async (event: ScheduledEvent) => {
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  try {
    const API_ENDPOINT = getEnvVar("NATIONAL_DIET_API_ENDPOINT");
    const GEMINI_API_KEY = getEnvVar("GEMINI_API_KEY");

    // Default to previous day in JST if env vars are not set
    const defaultDate = dateStrJST(-1);
    const FROM = (process.env.FROM_DATE && process.env.FROM_DATE.trim()) || defaultDate;
    const UNTIL = (process.env.UNTIL_DATE && process.env.UNTIL_DATE.trim()) || defaultDate;

    console.log(`[${runId}] Start. concurrency=${CONCURRENCY}`);

    // 1) Fetch
    const raw: RawMeetingData = await fetchNationalDietRecords(API_ENDPOINT, {
      ...(FROM ? { from: FROM } : {}),
      ...(UNTIL ? { until: UNTIL } : {}),
    });

    // 2) Group speeches by the base speech id
      const mapById = gatherSpeechesById(raw);
      // Cast to a typed record so bundle is not 'unknown'
      const entries = Object.entries(mapById as Record<string, { meetingInfo: any; speeches: any }>);
      console.log(`[${runId}] groups=${entries.length}`);

    // 3) Parallel summarize + store (with concurrency limit)
    const tasks: Array<() => Promise<TaskResult>> = entries.map(([baseId, bundle]) => {
      return async () => {
        const mappedIssue = {
          baseId,
          meetingInfo: bundle.meetingInfo,
          speeches: bundle.speeches,
        };
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

    const payload = {
      runId,
      startedAt,
      finishedAt,
      groups: entries.length,
      stored: ok.length,
      failed: ng.length,
      storedIds,
      failures: ng,
      filters: { from: FROM, until: UNTIL },
      eventSource: event?.source ?? "manual/local",
      concurrency: CONCURRENCY,
    };

    await logToS3("success", payload);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Event processed (parallel).', ...payload }),
    };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const err =
      error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };

    const errorPayload = {
      runId,
      startedAt,
      finishedAt,
      error: err,
      eventSource: (event as any)?.source ?? "manual/local",
    };

    console.error('[ERROR] Error processing event:', error);
    await logToS3("error", errorPayload);

    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Internal Server Error',
        error: err.message,
        runId,
      }),
    };
  }
};
