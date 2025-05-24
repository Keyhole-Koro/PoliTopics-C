import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import SpeechFormatter from './recordFormat';
import { MapIssue } from '@interfaces/Record'; // Assuming these types exist in your project
import { RawData, RawSpeech } from './RawRecord';
import fetchRecords from './NationalDietAPIHandler'; // Adjust the import path as necessary
import fetchNationalDietRecords from './NationalDietRecord'; // Adjust the import path as necessary

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
		const filePath: string = path.resolve(__dirname, 'fetchedRecord.json');
		const rawData: RawData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

		// Create an instance of SpeechFormatter
		const formatter: SpeechFormatter = new SpeechFormatter();

		// Format the records
		const formattedData: Record<string, MapIssue> = formatter.mapRecords(rawData);

		// Perform assertions
		expect(formattedData).toBeDefined();
		expect(typeof formattedData).toBe('object');
		expect(Object.keys(formattedData).length).toBeGreaterThan(0);

		// Check if a specific issue ID exists
		const issueIds: string[] = Object.keys(formattedData);
		expect(issueIds).toContain('121714024X01920250514'); // Replace with an actual ID from your data

		// Check if speeches are formatted correctly
		const firstIssue: MapIssue = formattedData[issueIds[0]];
		expect(firstIssue).toHaveProperty('speeches');
		expect(Array.isArray(firstIssue.speeches)).toBe(true);
		expect(firstIssue.speeches[0]).toHaveProperty('speaker');
		expect(firstIssue.speeches[0]).toHaveProperty('speech');

	});
});