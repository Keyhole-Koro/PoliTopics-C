import { handler } from "../src/lambda_handler";

(async () => {
  // Minimal ScheduledEvent-like object
  const event = { "source": "aws.events" } as any;

  process.env.AWS_REGION = process.env.AWS_REGION || "ap-northeast-3";
  process.env.AWS_ENDPOINT_URL = process.env.AWS_ENDPOINT_URL || "http://localhost:4566";
  process.env.TABLE_NAME = process.env.TABLE_NAME || "politopics";
  process.env.ERROR_BUCKET = process.env.ERROR_BUCKET || "politopics-error-logs";
  // Please set your real API and key in .env for full run:
  // process.env.NATIONAL_DIET_API_ENDPOINT = "...";
  // process.env.GEMINI_API_KEY = "...";

  console.log("Running local invoke...");

  const res = await handler(event, {} as any, () => {});
  console.log(res);
})();
