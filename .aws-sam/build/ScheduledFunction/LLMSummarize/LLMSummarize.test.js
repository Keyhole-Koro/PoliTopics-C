"use strict";
/*
import fs from 'fs';
import path from 'path';

import geminiAPI from './gemini';
import { compose_prompt } from './prompt';

import 'dotenv/config';


describe.only('Gemini API Handler', () => {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
    let rawData: Record<string, any>;

    beforeAll(() => {
        // Load and format the fetchedRecord.json file
        const filePath: string = path.resolve(__dirname, 'fetchedRecord.json');
        const rawData: any = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    });

    it('should generate summaries for formatted records', async () => {
        for (const [issueId, issue] of Object.entries(rawData)) {
            if (issueId === '121714024X01920250514') continue; // Skip this specific issue
            const issueText = JSON.stringify(issue, null, 2);
            const result = await geminiAPI(GEMINI_API_KEY, compose_prompt(issueText));
            const resultJson = JSON.parse(result);
            resultJson.id = resultJson.id.toString();
    
            console.log(`Generated Summary for Issue ${issueId}:`, resultJson, typeof resultJson);
    
            // Validate resultJson matches the Article structure
            expect(resultJson).toBeDefined();
            expect(typeof resultJson).toBe('object');

            // Write the resultJson to a summary.json file
            const outputFilePath = path.resolve(__dirname, 'summary.json');
            const existingSummaries = fs.existsSync(outputFilePath)
                ? JSON.parse(fs.readFileSync(outputFilePath, 'utf-8'))
                : {};

            existingSummaries[issueId] = resultJson;

            fs.writeFileSync(outputFilePath, JSON.stringify(existingSummaries, null, 2), 'utf-8');
    
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
        }
    }, 50000);
});
*/ 
