import {
  DynamoDBDocumentClient,
  PutCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { Article } from "@interfaces/Article";


interface ArticleWithMonth extends Article {
  month?: string; // optional string for GSI
}
// Utility: normalize a date value to string (always type "S" for DynamoDB)
function normalizeDateString(input: string | Date | number): string {
  if (typeof input === "string") {
    return input; // already a string, assume correct format (ISO or YYYY-MM-DD)
  }
  const d = typeof input === "number" ? new Date(input) : input;
  return d.toISOString(); // ex: "2025-08-20T01:23:45.678Z"
}

// Utility: derive "YYYY-MM" string from a date string
function deriveMonth(dateStr: string): string {
  return dateStr.slice(0, 7);
}

export default async function storeData(
  config: {
    doc: DynamoDBDocumentClient,
    article_table_name: string;
    keyword_table_name: string;
    participant_table_name: string;
   },
  article: ArticleWithMonth): Promise<{ ok: boolean; id: string }> {
  // Ensure `date` is present and normalized
  if (!article.date) {
    throw new Error("Article.date is required for MonthDateIndex.");
  }
  const dateStr = normalizeDateString(article.date as any);

  // Ensure `month` is present; derive if missing
  const monthStr = article.month && article.month.trim()
    ? article.month
    : deriveMonth(dateStr);

  if (!monthStr) {
    throw new Error("Derived month is empty. Ensure date is valid.");
  }

  // Prepare the main item with normalized `date` and `month`
  const itemToPut = {
    ...article,
    date: dateStr,
    month: monthStr,
  };

  // Insert/overwrite the article in the main table
  await config.doc.send(new PutCommand({
    TableName: config.article_table_name,
    Item: itemToPut,
  }));

  // Collect keyword and participant items for link tables
  const writes: Array<{ PutRequest: { Item: Record<string, any> } }> = [];

  for (const kw of article.keywords ?? []) {
    const keyword = (kw.keyword ?? "").trim();
    if (!keyword) continue;
    writes.push({ PutRequest: { Item: { keyword, dataId: article.id } } });
  }

  for (const p of article.participants ?? []) {
    const participant = (p.name ?? "").trim();
    if (!participant) continue;
    writes.push({ PutRequest: { Item: { participant, dataId: article.id } } });
  }

  // Batch write to keyword and participant tables (max 25 items per request)
  while (writes.length) {
    const chunk = writes.splice(0, 25);

    const kwItems = chunk.filter((x) => "keyword" in x.PutRequest.Item);
    if (kwItems.length) {
      await config.doc.send(new BatchWriteCommand({ RequestItems: { [config.keyword_table_name]: kwItems } }));
    }

    const ptItems = chunk.filter((x) => "participant" in x.PutRequest.Item);
    if (ptItems.length) {
      await config.doc.send(new BatchWriteCommand({ RequestItems: { [config.participant_table_name]: ptItems } }));
    }
  }

  return { ok: true, id: article.id };
}
