import fs from 'fs';
import path from 'path';
import fetchNationalDietRecords from './NationalDietAPIHandler';
import { gatherSpeechesById } from './formatRecord';
import { RawMeetingData, RawSpeechRecord } from './RawData';

import 'dotenv/config';

describe('fetchRecords', () => {
	const apiUrl = process.env.NATIONAL_DIET_API_ENDPOINT;

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

		const outputRawFilePath = path.resolve(__dirname, 'rawRecord.json');
		fs.writeFileSync(outputRawFilePath, JSON.stringify(records, null, 2), 'utf-8');

		expect(records).toBeDefined();

		// Save the fetched records to a JSON file for further testing
		const outputFilePath = path.resolve(__dirname, 'fetchedRecord.json');
		fs.writeFileSync(outputFilePath, JSON.stringify(records, null, 2), 'utf-8');

		*/
	it('should format the fetched records correctly', () => {
		// Load the fetchedRecord.json file
		const filePath: string = path.resolve(__dirname, 'fetchedRecord.json');
		console.log(`Loading data from: ${filePath}`);
		const rawData: RawMeetingData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

		// Format the records
		const formattedData: Record<string, { meetingInfo: any; speeches: RawSpeechRecord[] }> = gatherSpeechesById(rawData);

		// Save the formatted data to a JSON file for inspection
		const outputFilePath = path.resolve(__dirname, 'formattedRecord.json');
		fs.writeFileSync(outputFilePath, JSON.stringify(formattedData, null, 2), 'utf-8');
		console.log(`Formatted data saved to: ${outputFilePath}`);

		/*
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
		*/
	});
});