"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const NationalDietRecord_1 = __importDefault(require("./NationalDietRecord/NationalDietRecord"));
const LLMSummarize_1 = __importDefault(require("./LLMSummarize/LLMSummarize"));
const storeData_1 = __importDefault(require("./DynamoDBHandler/storeData"));
const formatRecord_1 = require("./NationalDietRecord/formatRecord");
require("dotenv/config");
// Utility to safely get and validate required env vars
function getEnvVar(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}
// Optional: move this into a /utils/logger.ts module
function log(tag, ...messages) {
    console.log(`[${tag}]`, ...messages);
}
// Core processing of a single issue
async function processIssue(issueId, speeches, geminiKey) {
    try {
        const article = await (0, LLMSummarize_1.default)(speeches, geminiKey);
        log('SUMMARIZE', `Generated summary for issue ${issueId}`);
        const response = await (0, storeData_1.default)(article);
        if (!response.ok) {
            throw new Error(`Storage failed: ${response.statusText}`);
        }
        console.log('LOG', article);
        log('STORE', `Article stored successfully for issue ${issueId}`);
    }
    catch (err) {
        console.error(`[PROCESS ISSUE] Error with issue ${issueId}:`, err);
    }
}
const handler = async (event) => {
    try {
        log('EVENT', 'Scheduled event received:', JSON.stringify(event));
        const NATIONAL_DIET_API_ENDPOINT = getEnvVar('NATIONAL_DIET_API_ENDPOINT');
        const GEMINI_API_KEY = getEnvVar('GEMINI_API_KEY');
        const today = new Date().toISOString().split('T')[0];
        const issues = await (0, NationalDietRecord_1.default)(NATIONAL_DIET_API_ENDPOINT, {
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
        const formattedData = (0, formatRecord_1.gatherSpeechesById)(issues); // optionally type this explicitly
        await Promise.all(Object.entries(formattedData).map(([issueId, speeches]) => processIssue(issueId, speeches, GEMINI_API_KEY)));
        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Event processed successfully.' }),
        };
    }
    catch (error) {
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
exports.handler = handler;
