import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import SpeechFormatter from '@NationalDietRecord/recordFormat';
import { RawData } from '@NationalDietRecord/RawRecord';
import { MapIssue } from '@interfaces/Record';

import geminiAPI from './gemini';
import { compose_prompt } from './prompt';

describe('Gemini API Handler', () => {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
    let formattedData: Record<string, MapIssue>;

    beforeAll(() => {
        // Load and format the fetchedRecord.json file
        const filePath: string = path.resolve(__dirname, 'fetchedRecord.json');
        const rawData: RawData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        const formatter: SpeechFormatter = new SpeechFormatter();
        formattedData = formatter.mapRecords(rawData);
    });

    it('should generate summaries for formatted records', async () => {
        for (const [issueId, issue] of Object.entries(formattedData)) {
            if (issueId === '121714024X01920250514') continue; // Skip this specific issue
            const issueText = JSON.stringify(issue, null, 2);
            const result = await geminiAPI(GEMINI_API_KEY, compose_prompt(issueText));
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
