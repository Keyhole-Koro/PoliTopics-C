import DynamoDBHandler from './dynamoDB';
import { Article } from '@interfaces/Article';
import fs from 'fs';
import path from 'path';
/*
describe.only('DynamoDBHandler', () => {
    const endpoint = 'http://localhost:8000'; // Local DynamoDB endpoint
    const accessKeyId = 'fakeAccessKeyId'; // Fake credentials for local DynamoDB
    const secretAccessKey = 'fakeSecretAccessKey';
    let dbHandler: DynamoDBHandler;
    let sampleArticle: Article;

    beforeAll(async () => {
        dbHandler = new DynamoDBHandler(endpoint, accessKeyId, secretAccessKey);

        // Load the sample article from summarySample.json
        const sampleFilePath = path.resolve(__dirname, 'summarySample.json');
        const sampleData = fs.readFileSync(sampleFilePath, 'utf-8');
        sampleArticle = JSON.parse(sampleData) as Article;

        // Ensure tables exist
        await dbHandler['ensureTableExists']('Articles');
        await dbHandler['ensureTableExists']('KeywordArticleIds');
        await dbHandler['ensureTableExists']('ParticipantArticleIds');
    });

    afterAll(async () => {
        // Clean up resources if needed
    });

    it('should add and retrieve an article', async () => {
        // Add the sample article
        await dbHandler.addRecord(sampleArticle);

        // Retrieve the article by ID
        const retrievedArticle = await dbHandler.getArticleById(sampleArticle.id);

        console.log('Retrieved Article:', retrievedArticle);
        expect(retrievedArticle).toBeDefined();
        expect(retrievedArticle?.id).toBe(sampleArticle.id);
        expect(retrievedArticle?.title).toBe(sampleArticle.title);
        expect(retrievedArticle?.keywords).toEqual(sampleArticle.keywords);
        expect(retrievedArticle?.participants[0].name).toBe(sampleArticle.participants[0].name);
    });

    it('should add and retrieve articles by keyword', async () => {
        // Add the sample article
        await dbHandler.addRecord(sampleArticle);
        // Retrieve articles by keyword
        const articles = await dbHandler.getArticlesByKeyword(sampleArticle.keywords[0].keyword.toString());
        
        expect(articles).toBeDefined();
        expect(articles.length).toBeGreaterThan(0);
        expect(articles[0].id).toBe(sampleArticle.id);
    });

    it('should add and retrieve articles by participant', async () => {
        // Add the sample article
        await dbHandler.addRecord(sampleArticle);

        // Retrieve articles by participant
        const articles = await dbHandler.getArticlesByParticipant(sampleArticle.participants[0].name);

        expect(articles).toBeDefined();
        expect(articles.length).toBeGreaterThan(0);
        expect(articles[0].id).toBe(sampleArticle.id);
    });

    it('should retrieve the latest articles', async () => {
        const articles = await dbHandler.getLatestArticles(5);

        expect(articles).toBeDefined();
        expect(articles.length).toBeGreaterThan(0);
    });

    it('should retrieve articles by date', async () => {
        const articles = await dbHandler.getArticleByDate(sampleArticle.date);

        expect(articles).toBeDefined();
        expect(articles.length).toBeGreaterThan(0);
    });
});
*/