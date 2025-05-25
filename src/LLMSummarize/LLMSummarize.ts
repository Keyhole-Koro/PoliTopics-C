import { MapIssue } from '@interfaces/Record';

import geminiAPI from './gemini';
import { compose_prompt } from './prompt';
import { Article } from '@interfaces/Article';

async function LLMSummarize(
  mappedRecords: Record<string, MapIssue>,
  GEMINI_API_KEY: string)
  : Promise<Article[]>
  {

  const results: JSON[] = [];
  
  for (const [issueId, issue] of Object.entries(mappedRecords)) {

    const issueText = JSON.stringify(issue, null, 2);
    const reslut = await geminiAPI(GEMINI_API_KEY, compose_prompt(issueText));

    results.push(JSON.parse(reslut));

  }

  return results.map(result => result as unknown as Article);
}

export default LLMSummarize;