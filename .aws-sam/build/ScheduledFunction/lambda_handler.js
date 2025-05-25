"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const NationalDietRecord_1 = __importDefault(require("./NationalDietRecord/NationalDietRecord"));
const LLMSummarize_1 = __importDefault(require("./LLMSummarize/LLMSummarize"));
const dynamoDB_1 = __importDefault(require("./DynamoDBHandler/dynamoDB"));
require("dotenv/config");
const handler = async (event) => {
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
        const dynamoDBHandler = new dynamoDB_1.default(AWS_DYNAMODB_ENDPOINT, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY);
        const records = await (0, NationalDietRecord_1.default)(NATIONAL_DIET_API_ENDPOINT, {
            from: '2025-01-01',
            until: '2025-05-01',
            recordPacking: 'json',
        });
        console.log("Fetched records:", records);
        const articles = await (0, LLMSummarize_1.default)(records, GEMINI_API_KEY);
        console.log("Generated summaries:", articles);
        for (const article of articles) {
            await dynamoDBHandler.addRecord(article);
        }
        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Event processed" }),
        };
    }
    catch (error) {
        console.error("Error processing event:", error);
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Internal Server Error", error: errorMessage }),
        };
    }
};
exports.handler = handler;
