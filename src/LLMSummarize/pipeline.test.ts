import fs from 'fs';
import path from 'path';
import 'dotenv/config';

import * as prompt from '@LLMSummarize/prompt';
import { processRawMeetingData } from '@LLMSummarize/pipeline';
import { GeminiClient } from "@llm/geminiClient";
import type { RawMeetingData } from '@interfaces/Raw';
import type { Article } from '@interfaces/Article';

const samplePath = path.resolve(__dirname, './sample.json');

if (!fs.existsSync(samplePath)) {
  throw new Error('❌ sample.json not found. Please create it with appropriate test data.');
}

import sample from './sample.json';

process.env.LLM_RPS = '0.15';
process.env.LLM_BURST = '1';
process.env.LLM_CHUNK_CONCURRENCY = '1';
process.env.REDUCE_CONCURRENCY = '1';
process.env.REDUCE_GROUP_SIZE = '8';

const llm = new GeminiClient({
  apiKey: process.env.GEMINI_API_KEY!,
  model: process.env.GEMINI_MODEL_NAME || "gemini-2.5-flash",
});

describe('processRawMeetingData', () => {
  it('should process raw meeting data correctly', async () => {
    const charThreshold = 15000;

    const articles: Article[] = await processRawMeetingData({
      rawData: sample,
      instruction: prompt.instruction,
      output_format: prompt.output_format,
      charThreshold,
      llm
    });

    console.log('Processed articles:', articles);

    expect(articles).toBeDefined();
    expect(articles.length).toBeGreaterThan(0);
  }, 500000);
});
