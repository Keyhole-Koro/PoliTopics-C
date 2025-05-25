"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const recordFormat_1 = __importDefault(require("../NationalDietRecord/recordFormat"));
const gemini_1 = __importDefault(require("./gemini"));
const prompt_1 = require("./prompt");
require("dotenv/config");
describe('Gemini API Handler', () => {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
    let formattedData;
    beforeAll(() => {
        // Load and format the fetchedRecord.json file
        const filePath = path_1.default.resolve(__dirname, 'fetchedRecord.json');
        const rawData = JSON.parse(fs_1.default.readFileSync(filePath, 'utf-8'));
        const formatter = new recordFormat_1.default();
        formattedData = formatter.mapRecords(rawData);
    });
    it('should generate summaries for formatted records', async () => {
        for (const [issueId, issue] of Object.entries(formattedData)) {
            if (issueId === '121714024X01920250514')
                continue; // Skip this specific issue
            const issueText = JSON.stringify(issue, null, 2);
            const result = await (0, gemini_1.default)(GEMINI_API_KEY, (0, prompt_1.compose_prompt)(issueText));
            const resultJson = JSON.parse(result);
            console.log(`Generated Summary for Issue ${issueId}:`, resultJson, typeof resultJson);
            // Validate resultJson matches the Article structure
            expect(resultJson).toBeDefined();
            expect(typeof resultJson).toBe('object');
            /*
    
            // Check if resultJson matches the Article structure
            expect(resultJson).toHaveProperty('title');
            console.log(`Title: ${resultJson.title}, Type: ${typeof resultJson.title}`);
            expect(typeof resultJson.title).toBe('string');
    
            expect(resultJson).toHaveProperty('summary');
            expect(typeof resultJson.summary).toBe('string');
    
            expect(resultJson).toHaveProperty('content');
            expect(typeof resultJson.content).toBe('string');

    
            // Optional fields
            if (resultJson.author) {
                expect(typeof resultJson.author).toBe('string');
            }
            if (resultJson.date) {
                expect(typeof resultJson.date).toBe('string');
            }
            */
        }
    }, 50000);
});
