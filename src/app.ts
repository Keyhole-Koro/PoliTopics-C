import 'dotenv/config';
import { handler } from './lambda_handler';
import type { ScheduledEvent } from 'aws-lambda';

(async () => {
  // Minimal ScheduledEvent-like object
  const event: ScheduledEvent = { source: 'aws.events' } as any;

  // Local defaults (can be overridden by .env)
  process.env.AWS_REGION = process.env.AWS_REGION || 'ap-northeast-3';
  process.env.AWS_ENDPOINT_URL = process.env.AWS_ENDPOINT_URL || 'http://localhost:4566';
  process.env.TABLE_NAME = process.env.TABLE_NAME || 'politopics';
  process.env.ERROR_BUCKET = process.env.ERROR_BUCKET || 'politopics-error-logs';

  // Date range (JST). FROM=since, UNTIL=until
  process.env.FROM_DATE = process.env.FROM_DATE || '2025-06-01';
  process.env.UNTIL_DATE = process.env.UNTIL_DATE || '2025-06-30'; // ← 修正

  // Please set your real API and key in .env for full run:
  // process.env.NATIONAL_DIET_API_ENDPOINT = "...";
  // process.env.GEMINI_API_KEY = "...";

  console.log('Running local invoke...');

  const res = await handler(event as any, {} as any, () => {});
  console.log(res);
})();
