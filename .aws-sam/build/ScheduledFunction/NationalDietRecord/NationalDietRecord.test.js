"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const recordFormat_1 = __importDefault(require("./recordFormat"));
require("dotenv/config");
describe('fetchRecords', () => {
    const apiUrl = process.env.DIET_API_ENDPOINT;
    /*
    it('should fetch records successfully', async () => {
        if (!apiUrl) {
            throw new Error('API_URL is not defined in the .env file');
        }

        const params = {
            from: '2025-01-01',
            until: '2025-05-01',
        };

        const records = await fetchNationalDietRecords(apiUrl, params);

        console.log(records)

        expect(records).toBeDefined();
    });
    */
    it('should format the fetched records correctly', () => {
        // Load the fetchedRecord.json file
        const filePath = path_1.default.resolve(__dirname, 'fetchedRecord.json');
        const rawData = JSON.parse(fs_1.default.readFileSync(filePath, 'utf-8'));
        // Create an instance of SpeechFormatter
        const formatter = new recordFormat_1.default();
        // Format the records
        const formattedData = formatter.mapRecords(rawData);
        // Perform assertions
        expect(formattedData).toBeDefined();
        expect(typeof formattedData).toBe('object');
        expect(Object.keys(formattedData).length).toBeGreaterThan(0);
        // Check if a specific issue ID exists
        const issueIds = Object.keys(formattedData);
        expect(issueIds).toContain('121714024X01920250514'); // Replace with an actual ID from your data
        // Check if speeches are formatted correctly
        const firstIssue = formattedData[issueIds[0]];
        expect(firstIssue).toHaveProperty('speeches');
        expect(Array.isArray(firstIssue.speeches)).toBe(true);
        expect(firstIssue.speeches[0]).toHaveProperty('speaker');
        expect(firstIssue.speeches[0]).toHaveProperty('speech');
    });
});
