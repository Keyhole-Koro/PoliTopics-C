import { Handler, ScheduledEvent } from 'aws-lambda';

import fetchNationalDietRecords from '@NationalDietRecord/NationalDietRecord';
import LLMSummarize from '@LLMSummarize/LLMSummarize';
import storeData from '@DynamoDBHandler/storeData';

import { RawMeetingData, RawSpeechRecord } from '@NationalDietRecord/RawData';
import { gatherSpeechesById } from '@NationalDietRecord/formatRecord';

import 'dotenv/config';

// Utility to safely get and validate required env vars
function getEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Optional: move this into a /utils/logger.ts module
function log(tag: string, ...messages: any[]) {
  console.log(`[${tag}]`, ...messages);
}

// Core processing of a single issue
async function processIssue(issueId: string, speeches: any, geminiKey: string) {
  try {
    const article = await LLMSummarize(speeches, geminiKey);
    log('SUMMARIZE', `Generated summary for issue ${issueId}`);

    const response = await storeData(article);
    if (!response.ok) {
      throw new Error(`Storage failed: ${response.statusText}`);
    }
    console.log('LOG', article);

    log('STORE', `Article stored successfully for issue ${issueId}`);
  } catch (err) {
    console.error(`[PROCESS ISSUE] Error with issue ${issueId}:`, err);
  }
}

export const handler: Handler<ScheduledEvent> = async (event) => {
  try {
    log('EVENT', 'Scheduled event received:', JSON.stringify(event));

    const NATIONAL_DIET_API_ENDPOINT = getEnvVar('NATIONAL_DIET_API_ENDPOINT');
    const GEMINI_API_KEY = getEnvVar('GEMINI_API_KEY');

    const today = new Date().toISOString().split('T')[0];

    const issues: RawMeetingData = await fetchNationalDietRecords(NATIONAL_DIET_API_ENDPOINT, {
      from: today,
      until: today,
      recordPacking: 'json',
    });

    if (issues.numberOfRecords === 0 || !issues.meetingRecord.length) {
      const message = `No records found for ${today}.`;
      log('INFO', message);
      return {
        statusCode: 200,
        body: JSON.stringify({ message }),
      };
    }

    const formattedData = gatherSpeechesById(issues); // optionally type this explicitly

    await Promise.all(
      Object.entries(formattedData).map(([issueId, speeches]) =>
        processIssue(issueId, speeches, GEMINI_API_KEY)
      )
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Event processed successfully.' }),
    };

  } catch (error) {
    console.error('[ERROR] Error processing event:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Internal Server Error',
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};
