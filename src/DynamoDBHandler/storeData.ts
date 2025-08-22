import {
  DynamoDBDocumentClient,
  PutCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { Article } from "@interfaces/Article";


export default async function storeData(
  config: {
    doc: DynamoDBDocumentClient,
    article_table_name: string;
    keyword_table_name: string;
    participant_table_name: string;
   },
  article: Article): Promise<{ ok: boolean; id: string }> {

  // Insert/overwrite the article in the main table
  await config.doc.send(new PutCommand({
    TableName: config.article_table_name,
    Item: article,
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
