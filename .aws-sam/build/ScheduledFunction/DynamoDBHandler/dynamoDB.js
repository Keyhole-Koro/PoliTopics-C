"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
class DynamoDBHandler {
    constructor(endpoint, access_key_id, secret_access_key) {
        this.ARTICLE_TABLE_NAME = "Articles";
        this.KEYWORD_TABLE_NAME = "KeywordArticleIds";
        this.PARTICIPANT_TABLE_NAME = "ParticipantArticleIds";
        this.REGION = "ap-northeast-3";
        this.DateIndex = "DateIndex";
        this.createdTables = new Set();
        this.client = new client_dynamodb_1.DynamoDBClient({
            region: this.REGION,
            endpoint: endpoint,
            credentials: {
                accessKeyId: access_key_id,
                secretAccessKey: secret_access_key,
            },
        });
        this.ddbDocClient = lib_dynamodb_1.DynamoDBDocumentClient.from(this.client);
    }
    // Check if table exists, if not create it
    async ensureTableExists(tableName) {
        if (this.createdTables.has(tableName))
            return;
        try {
            await this.client.send(new client_dynamodb_1.DescribeTableCommand({ TableName: tableName }));
            // Table exists
            this.createdTables.add(tableName);
        }
        catch (error) {
            if (error.name === "ResourceNotFoundException") {
                console.log(`Table "${tableName}" not found. Creating...`);
                // Basic table schema, you can customize per table
                let params = {
                    TableName: tableName,
                    BillingMode: client_dynamodb_1.BillingMode.PAY_PER_REQUEST,
                };
                // Define key schema depending on table
                if (tableName === this.ARTICLE_TABLE_NAME) {
                    params.AttributeDefinitions = [
                        { AttributeName: "id", AttributeType: "S" },
                        { AttributeName: "date", AttributeType: "S" }, // Required for GSI
                    ];
                    params.KeySchema = [
                        { AttributeName: "id", KeyType: "HASH" }
                    ];
                    params.GlobalSecondaryIndexes = [
                        {
                            IndexName: "DateIndex",
                            KeySchema: [
                                { AttributeName: "date", KeyType: "HASH" }
                            ],
                            Projection: {
                                ProjectionType: "ALL"
                            },
                            ProvisionedThroughput: {
                                ReadCapacityUnits: 5,
                                WriteCapacityUnits: 5
                            }
                        }
                    ];
                }
                else if (tableName === this.KEYWORD_TABLE_NAME) {
                    params.AttributeDefinitions = [{ AttributeName: "keyword", AttributeType: "S" }];
                    params.KeySchema = [{ AttributeName: "keyword", KeyType: "HASH" }];
                }
                else if (tableName === this.PARTICIPANT_TABLE_NAME) {
                    params.AttributeDefinitions = [{ AttributeName: "participant", AttributeType: "S" }];
                    params.KeySchema = [{ AttributeName: "participant", KeyType: "HASH" }];
                }
                else {
                    throw new Error(`Unknown table name: ${tableName}`);
                }
                await this.client.send(new client_dynamodb_1.CreateTableCommand(params));
                console.log(`Table "${tableName}" created successfully.`);
                // Wait for table to be active (optional but recommended)
                // Could implement waiter here or sleep
                // For brevity, just add to createdTables here
                this.createdTables.add(tableName);
            }
            else {
                console.error("Error describing table:", error);
                throw error;
            }
        }
    }
    async putItem(params) {
        await this.ensureTableExists(params.input.TableName);
        try {
            await this.ddbDocClient.send(params);
            console.log(`Successfully added item to ${params.input.TableName}`);
        }
        catch (error) {
            console.error(`Error adding item to ${params.input.TableName}:`, error);
        }
    }
    async queryItems(command) {
        try {
            const result = await this.ddbDocClient.send(command);
            return (result.Items || []).map((item) => item.dataId.S);
        }
        catch (error) {
            console.error("Error retrieving data IDs:", error);
            return [];
        }
    }
    async addRecord(record) {
        await this.addArticle(record);
        console.log("Article added successfully.");
        for (const key of record.keywords) {
            await this.addKeyword(key.keyword, record.id);
        }
        console.log("Keywords added successfully.");
        for (const participant of record.participants) {
            await this.addParticipant(participant.name, record.id);
        }
        console.log("Participants added successfully.");
    }
    async addArticle(article) {
        const command = new client_dynamodb_1.PutItemCommand({
            TableName: this.ARTICLE_TABLE_NAME,
            Item: {
                id: { S: article.id },
                title: { S: article.title },
                date: { S: article.date },
                category: { S: article.category },
                summary: { S: article.summary?.summary ?? "" },
                soft_summary: { S: article.soft_summary?.summary ?? "" },
                description: { S: article.description ?? "" },
                dialogs: {
                    L: (article.dialogs ?? []).map((dialog) => ({
                        M: {
                            order: { N: dialog.order?.toString() ?? "0" },
                            speaker: { S: dialog.speaker ?? "" },
                            summary: { S: dialog.summary ?? "" },
                            response_to: {
                                L: (dialog.response_to ?? []).map((resp) => ({
                                    M: {
                                        dialog_id: { N: (resp.dialog_id ?? 0).toString() },
                                        reaction: { S: resp.reaction ?? "" },
                                    },
                                })),
                            },
                        },
                    })),
                },
                participants: {
                    L: (article.participants ?? []).map((participant) => ({
                        M: {
                            name: { S: participant.name ?? "" },
                            summary: { S: participant.summary ?? "" },
                        },
                    })),
                },
                keywords: {
                    L: (article.keywords ?? []).map((kw) => ({
                        M: {
                            keyword: { S: kw.keyword ?? "" },
                            priority: { S: kw.priority ?? "" },
                        },
                    })),
                },
                terms: {
                    L: (article.terms ?? []).map((term) => ({
                        M: {
                            term: { S: term.term ?? "" },
                            definition: { S: term.definition ?? "" },
                        },
                    })),
                }
            },
        });
        await this.putItem(command);
    }
    async addKeyword(keyword, articleId) {
        await this.ensureTableExists(this.KEYWORD_TABLE_NAME);
        const command = new client_dynamodb_1.PutItemCommand({
            TableName: this.KEYWORD_TABLE_NAME,
            Item: {
                keyword: { S: keyword },
                dataId: { S: articleId },
            },
        });
        await this.putItem(command);
    }
    async addParticipant(participant, articleId) {
        await this.ensureTableExists(this.PARTICIPANT_TABLE_NAME);
        const command = new client_dynamodb_1.PutItemCommand({
            TableName: this.PARTICIPANT_TABLE_NAME,
            Item: {
                participant: { S: participant },
                dataId: { S: articleId },
            },
        });
        await this.putItem(command);
    }
    async getArticleIdsByKeyword(keyword) {
        const command = new client_dynamodb_1.QueryCommand({
            TableName: this.KEYWORD_TABLE_NAME,
            KeyConditionExpression: "#k = :keywordValue",
            ExpressionAttributeNames: { "#k": "keyword" },
            ExpressionAttributeValues: { ":keywordValue": { S: keyword } },
        });
        return this.queryItems(command);
    }
    async getArticleIdsByParticipant(participant) {
        const command = new client_dynamodb_1.QueryCommand({
            TableName: this.PARTICIPANT_TABLE_NAME,
            KeyConditionExpression: "#p = :participantValue",
            ExpressionAttributeNames: { "#p": "participant" },
            ExpressionAttributeValues: { ":participantValue": { S: participant } },
        });
        return this.queryItems(command);
    }
    async getArticlesByKeyword(keyword) {
        const articleIds = await this.getArticleIdsByKeyword(keyword);
        if (!articleIds.length)
            return [];
        const articles = await Promise.all(articleIds.map((id) => this.getArticleById(id)));
        return articles.filter((article) => article !== null);
    }
    async getArticlesByParticipant(participant) {
        const articleIds = await this.getArticleIdsByParticipant(participant);
        if (!articleIds.length)
            return [];
        const articles = await Promise.all(articleIds.map((id) => this.getArticleById(id)));
        return articles.filter((article) => article !== null);
    }
    async getArticleById(id) {
        const command = new lib_dynamodb_1.GetCommand({
            TableName: this.ARTICLE_TABLE_NAME,
            Key: { id: id },
        });
        try {
            const response = await this.ddbDocClient.send(command);
            return response.Item;
        }
        catch (error) {
            console.error("Error retrieving article:", error);
            return null;
        }
    }
    async getLatestArticles(limit) {
        const command = new client_dynamodb_1.ScanCommand({
            TableName: this.ARTICLE_TABLE_NAME,
            Limit: limit,
        });
        try {
            const response = await this.ddbDocClient.send(command);
            return response.Items;
        }
        catch (error) {
            console.error("Error retrieving latest articles:", error);
            return [];
        }
    }
    async getArticleByDate(date) {
        const command = new client_dynamodb_1.QueryCommand({
            TableName: this.ARTICLE_TABLE_NAME,
            IndexName: this.DateIndex,
            KeyConditionExpression: "#date = :dateValue",
            ExpressionAttributeNames: { "#date": "date" },
            ExpressionAttributeValues: { ":dateValue": { S: date } },
        });
        try {
            const response = await this.ddbDocClient.send(command);
            return response.Items;
        }
        catch (error) {
            console.error("Error retrieving articles by date:", error);
            return [];
        }
    }
}
exports.default = DynamoDBHandler;
