import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import storeData, { listMonth } from "@DynamoDBHandler/storeData";
import type { Article } from "@interfaces/Article";

const region = process.env.AWS_REGION || "ap-northeast-3";
const endpoint = process.env.AWS_ENDPOINT_URL || "http://localhost:4566";
const table_name = process.env.DDB_TABLE_NAME || "politopics";

// Create DDB doc client (removeUndefinedValues to mimic production)
const ddb = new DynamoDBClient({ region, endpoint });
const doc = DynamoDBDocumentClient.from(ddb, {
  marshallOptions: { removeUndefinedValues: true },
});

function uid(prefix: string) {
  return prefix + Math.random().toString(36).slice(2, 10);
}

function dummyArticle(overrides: Partial<Article> = {}): Article {
  const id = uid("test-");
  const date = "2099-01-02T00:00:00.000Z"; // far future to avoid collisions
  return {
    id,
    title: "テスト記事",
    date,
    month: "2099-01",
    imageKind: "会議録",
    session: 1,
    nameOfHouse: "衆議院",
    nameOfMeeting: "本会議",
    categories: ["テスト"],
    description: "ローカルDynamoDB統合テスト用のダミー記事",
    summary: {
      title: "要約タイトル",
      overview: "要約本文",
      participants: [],
      key_points: [],
    },
    soft_summary: {
      title: "ソフト要約",
      overview: "やさしい表現の概要",
      participants: [],
      key_points: [],
    },
    middle_summary: [],
    dialogs: [],
    ...overrides,
  } as Article;
}

describe("DynamoDB local integration (@ddb)", () => {
  jest.setTimeout(60_000);

  test("storeData() writes main item and is queryable via GSI", async () => {
    const article = dummyArticle();
    const stored = await storeData({ doc, table_name }, article);
    expect(stored).toBeDefined();

    // Fetch by main PK/SK
    const res = await doc.send(new GetCommand({
      TableName: table_name,
      Key: { PK: `A#${article.id}`, SK: "META" },
    }));
    expect(res.Item?.id).toBe(article.id);
    expect(res.Item?.type).toBe("ARTICLE");

    // Query by month GSI to ensure the index item exists
    const q = await listMonth({ doc, table_name }, article.month, { limit: 10 });
    const ids = (q.Items || []).map((it: any) => it.id);
    expect(ids).toContain(article.id);
  });
});
