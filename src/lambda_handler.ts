import { Handler, ScheduledEvent } from 'aws-lambda';

import fetchNationalDietRecords from '@NationalDietRecord/NationalDietRecord';
import LLMSummarize from '@LLMSummarize/LLMSummarize';
import DynamoDBHandler from '@DynamoDBHandler/dynamoDB';

import 'dotenv/config';

export const handler: Handler<ScheduledEvent> = async (event) => {
  try {
    console.log("Scheduled event received:", event);

    const NATIONAL_DIET_API_ENDPOINT = process.env.NATIONAL_DIET_API_ENDPOINT || 'https://api.example.com/records';
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
    
    const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
    const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
    const AWS_DYNAMODB_ENDPOINT = process.env.AWS_DYNAMODB_ENDPOINT;

    if (!NATIONAL_DIET_API_ENDPOINT || !GEMINI_API_KEY || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY || !AWS_DYNAMODB_ENDPOINT) {
      console.error("Missing required environment variables.");
      throw new Error("Environment variables are not properly set.");
    }

    const dynamoDBHandler = new DynamoDBHandler(
      AWS_DYNAMODB_ENDPOINT,
      AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY
    );


    const today = new Date().toISOString().split('T')[0];

    const records = await fetchNationalDietRecords(NATIONAL_DIET_API_ENDPOINT, {
      from: today,
      until: today,
      recordPacking: 'json',
    });
    
    console.log("Fetched records:", records);

    const articles = await LLMSummarize(records, GEMINI_API_KEY);
    console.log("Generated summaries:", articles);

    for (const article of articles) {
      await dynamoDBHandler.addRecord(article);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Event processed" }),
    };
  } catch (error) {
    console.error("Error processing event:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Internal Server Error", error: errorMessage }),
    };
  }
};