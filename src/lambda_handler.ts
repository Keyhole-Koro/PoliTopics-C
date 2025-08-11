import { Handler, ScheduledEvent } from 'aws-lambda';

import fetchNationalDietRecords from '@NationalDietRecord/NationalDietRecord';
import LLMSummarize from '@LLMSummarize/LLMSummarize';
import storeData from '@DynamoDBHandler/storeData';

import { RawMeetingData } from '@NationalDietRecord/RawData';
import { gatherSpeechesById } from '@NationalDietRecord/formatRecord';

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import crypto from "node:crypto";
import 'dotenv/config';

function getEnvVar(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

const region = process.env.AWS_REGION || "ap-northeast-3";
const endpoint = process.env.AWS_ENDPOINT_URL;
const s3 = new S3Client({ region, ...(endpoint ? { endpoint } : {}) });

async function logToS3(kind: "error" | "success", payload: any) {
  // Reuse ERROR_BUCKET for both error and success logs (different prefixes)
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

export const handler: Handler = async (event: ScheduledEvent) => {
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  try {
    const API_ENDPOINT = getEnvVar("NATIONAL_DIET_API_ENDPOINT");
    const GEMINI_API_KEY = getEnvVar("GEMINI_API_KEY");
    const FROM = process.env.FROM_DATE;
    const UNTIL = process.env.UNTIL_DATE;

    // 1) Fetch
    const raw: RawMeetingData = await fetchNationalDietRecords(API_ENDPOINT, {
      ...(FROM ? { from: FROM } : {}),
      ...(UNTIL ? { until: UNTIL } : {}),
    });

    // 2) Group speeches by the base speech id
    const mapById = gatherSpeechesById(raw);

    // 3) For each speech group -> summarize & store
    let okCount = 0;
    const storedIds: string[] = [];

    for (const [baseId, bundle] of Object.entries(mapById)) {
      const mappedIssue = {
        baseId,
        meetingInfo: bundle.meetingInfo,
        speeches: bundle.speeches,
      };

      const article = await LLMSummarize(mappedIssue, GEMINI_API_KEY);
      await storeData(article);
      okCount++;
      if (article?.id) storedIds.push(article.id);
    }

    const finishedAt = new Date().toISOString();
    const successPayload = {
      runId,
      startedAt,
      finishedAt,
      stored: okCount,
      storedIds,
      filters: { from: FROM, until: UNTIL },
      eventSource: event?.source ?? "manual/local",
    };

    await logToS3("success", successPayload);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Event processed successfully.', ...successPayload }),
    };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const err = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };

    const errorPayload = {
      runId,
      startedAt,
      finishedAt,
      error: err,
      eventSource: event?.source ?? "manual/local",
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
