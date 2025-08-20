
import geminiAPI from './gemini';
import { compose_prompt } from './prompt';
import { Article } from '@interfaces/Article';

async function LLMSummarize(
  model_name: string,
  mappedIssue: any,
  GEMINI_API_KEY: string)
  : Promise<Article>
  {

  const issueText = JSON.stringify(mappedIssue, null, 2);
  const result = await geminiAPI(model_name, GEMINI_API_KEY, compose_prompt(issueText));

  const json_result = JSON.parse(result);
  // since dynamoDB stores id as a string, we need to convert it to string
  json_result.id = json_result.id.toString();

  return json_result as Article;
}

export default LLMSummarize;