import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { Article } from "@interfaces/Article";

const region = process.env.AWS_REGION || "ap-northeast-3";
const endpoint = process.env.AWS_ENDPOINT_URL;

// Fixed table names with optional env override (not required to set)
const ARTICLE_TABLE =
  process.env.ARTICLE_TABLE_NAME || "politopics-article";
const KEYWORD_TABLE =
  process.env.KEYWORD_TABLE_NAME || "politopics-keywords";
const PARTICIPANT_TABLE =
  process.env.PARTICIPANT_TABLE_NAME || "politopics-participants";

const ddb = new DynamoDBClient({ region, ...(endpoint ? { endpoint } : {}) });
const doc = DynamoDBDocumentClient.from(ddb);

/**
 * Persist the article into the main "politopics-article" table (HASH=id),
 * and create link items into:
 *   - "politopics-keywords"     (PK=keyword, SK=dataId)
 *   - "politopics-participants" (PK=participant, SK=dataId)
 *
 * The main table also exposes GSI "DateIndex" on attribute "date".
 */
export default async function storeData(article: Article) {
  // 1) Put the article document (idempotent by condition)
  try {
    await doc.send(
      new PutCommand({
        TableName: ARTICLE_TABLE,
        Item: article, // expected to include 'id' (HASH) and 'date' (for GSI)
        ConditionExpression: "attribute_not_exists(#id)",
        ExpressionAttributeNames: { "#id": "id" },
      })
    );
  } catch (e) {
    // If already exists, treat as success (idempotent)
    if (!(e instanceof ConditionalCheckFailedException)) {
      throw e;
    }
  }

  // 2) Build link writes (25 items per BatchWrite)
  const writes: Array<{ PutRequest: { Item: Record<string, any> } }> = [];

  for (const kw of article.keywords ?? []) {
    const keyword = (kw.keyword ?? "").trim();
    if (!keyword) continue;
    writes.push({
      PutRequest: {
        Item: {
          keyword,
          dataId: article.id,
        },
      },
    });
  }

  for (const p of article.participants ?? []) {
    const participant = (p.name ?? "").trim();
    if (!participant) continue;
    writes.push({
      PutRequest: {
        Item: {
          participant,
          dataId: article.id,
        },
      },
    });
  }

  // 3) Flush links in chunks
  while (writes.length) {
    const chunk = writes.splice(0, 25);
    // keywords
    const kwItems = chunk.filter((x) => "keyword" in x.PutRequest.Item);
    if (kwItems.length) {
      await doc.send(
        new BatchWriteCommand({
          RequestItems: { [KEYWORD_TABLE]: kwItems },
        })
      );
    }
    // participants
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
