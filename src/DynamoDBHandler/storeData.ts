import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { Article } from "@interfaces/Article";

const region = process.env.AWS_REGION || "ap-northeast-3";
const endpoint = process.env.AWS_ENDPOINT_URL; // for LocalStack

const ddb = new DynamoDBClient({ region, ...(endpoint ? { endpoint } : {}) });
const doc = DynamoDBDocumentClient.from(ddb);

const TABLE = process.env.TABLE_NAME || "politopics";

/**
 * Single-table design:
 * - Article item: PK=ARTICLE#{id}, SK=META, gsi1pk=DATE#{date}, gsi1sk={id}
 * Store the whole article JSON in one item for simplicity.
 */
export default async function storeData(article: Article) {
  const item = {
    PK: `ARTICLE#${article.id}`,
    SK: "META",
    type: "Article",
    createdAt: new Date().toISOString(),
    gsi1pk: `DATE#${article.date}`,
    gsi1sk: article.id,
    ...article,
  };

  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: item,
      ConditionExpression: "attribute_not_exists(PK)",
    })
  );

  return { ok: true, id: article.id };
}
