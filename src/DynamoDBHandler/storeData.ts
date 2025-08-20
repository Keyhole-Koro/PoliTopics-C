import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  DeleteCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { Article } from "@interfaces/Article";

const region = process.env.AWS_REGION || "ap-northeast-3";
const endpoint = process.env.AWS_ENDPOINT_URL;

// Fixed table names with optional env override
const ARTICLE_TABLE = process.env.ARTICLE_TABLE_NAME || "politopics-article";
const KEYWORD_TABLE = process.env.KEYWORD_TABLE_NAME || "politopics-keywords";
const PARTICIPANT_TABLE = process.env.PARTICIPANT_TABLE_NAME || "politopics-participants";

const ddb = new DynamoDBClient({ region, ...(endpoint ? { endpoint } : {}) });
const doc = DynamoDBDocumentClient.from(ddb);

/**
 * Store an article and its related keywords and participants in DynamoDB.
 * If the article already exists, delete it (and its related links) first,
 * then insert the new data.
 */
export default async function storeData(article: Article) {

  // Insert the new article (main table)
  await doc.send(
    new PutCommand({
      TableName: ARTICLE_TABLE,
      Item: article,
    })
  );

  // Prepare new keyword and participant link items
  const writes: Array<{ PutRequest: { Item: Record<string, any> } }> = [];

  for (const kw of article.keywords ?? []) {
    const keyword = (kw.keyword ?? "").trim();
    if (!keyword) continue;
    writes.push({
      PutRequest: { Item: { keyword, dataId: article.id } },
    });
  }

  for (const p of article.participants ?? []) {
    const participant = (p.name ?? "").trim();
    if (!participant) continue;
    writes.push({
      PutRequest: { Item: { participant, dataId: article.id } },
    });
  }

  // Batch write new keyword and participant links (25 items per batch)
  while (writes.length) {
    const chunk = writes.splice(0, 25);

    const kwItems = chunk.filter((x) => "keyword" in x.PutRequest.Item);
    if (kwItems.length) {
      await doc.send(
        new BatchWriteCommand({
          RequestItems: { [KEYWORD_TABLE]: kwItems },
        })
      );
    }

    const ptItems = chunk.filter((x) => "participant" in x.PutRequest.Item);
    if (ptItems.length) {
      await doc.send(
        new BatchWriteCommand({
          RequestItems: { [PARTICIPANT_TABLE]: ptItems },
        })
      );
    }
  }

  return { ok: true, id: article.id };
}
