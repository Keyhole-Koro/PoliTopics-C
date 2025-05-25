"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compose_prompt = exports.output_format = exports.instruction = void 0;
exports.instruction = `以下の会話内容をもとに、次の形式で要約データを構成してください：

各セクションは、元の発言の意図やトーンを尊重しつつ、読者の知識レベルに応じて読みやすく調整してください。

---

1. **基本情報（Metadata）**  
　会議に関するメタデータを記載してください：タイトル、開催日、開催機関、カテゴリなど。

2. **全体の要約（Summary）**  
　会議全体の要点や結論を簡潔にまとめてください。発言者の言い回しや口調に近い文体で書いてください。

3. **やさしい要約（SoftSummary）**  
　政治や専門用語に馴染みのない読者向けに、背景や文脈も含めてわかりやすく丁寧に説明してください。  
　難解な表現や専門用語はできるだけ避け、必要に応じて補足をつけてください。

4. **中間要約（MiddleSummary）**  
　議論の重要な転換点や話題ごとのまとまりを要約してください。構成順に並べてください。

5. **発言ごとの要約（Dialogs）**  
　各発言について、以下の情報を含めて記述してください：

　- \`summary\`: その発言の主旨を簡潔に要約してください。  
　- \`soft_summary\`: 一般読者にも伝わるように、やさしく丁寧に言い換えてください。話者の意図や背景も補足すると親切です。  
　- \`order\`, \`speaker\`, \`speaker_group\`, \`speaker_position\`, \`speaker_role\`：それぞれの発言者情報を記載してください。  
　- \`response_to\`: この発言がどの発言に対する反応かを明示してください（例：質問、賛同、反論など）。

6. **参加者情報（Participants）**  
　主な話者ごとに、名前・役職・発言内容の要旨をまとめてください。

7. **用語の解説（Terms）**  
　専門的または一般にはわかりにくい用語について、簡潔で明確な定義を記述してください。文脈に即した説明が望ましいです。

8. **キーワード抽出（Keywords）**  
　議論の焦点となる用語やトピックを抽出し、重要度（high / medium / low）を分類してください。

`;
exports.output_format = `### 出力フォーマット

以下の形式に従ってJSONデータを作成してください：

{
  "id": "文字列（議事録ID）",
  "title": "会議のタイトル",
  "date": "開催日 (YYYY-MM-DD)",
  "imageKind": "画像分類（例: graph, diagram, etc.）",
  "session": 数字（例: 208）,
  "nameOfHouse": "衆議院または参議院",
  "nameOfMeeting": "会議名（例: 国土交通委員会）",
  "category": "カテゴリ（例: 環境, 教育, etc.）",
  "description": "この会議についての説明",

  "summary": {
    "id": 1,
    "summary": "会話全体の要約をここに記載",
    "figure": "Markdown形式で図や補足を記載（任意）"
  },
  "soft_summary": {
    "id": 1,
    "summary": "政治に詳しくない人でも分かるように、丁寧でわかりやすく説明した要約"
  },
  "middle_summary": [
    {
      "order": 1,
      "summary": "中間要約1",
      "figure": "Markdown形式（任意）"
    }
  ],
  "dialogs": [
    {
      "order": 1,
      "speaker": "発言者名",
      "speaker_group": "所属",
      "speaker_position": "役職",
      "speaker_role": "役割",
      "summary": "発言内容の要約",
      "soft_summary": "発言の内容を、政治に詳しくない人でも理解できるように説明した文章",
      "response_to": [
        {
          "id": 発言ID,
          "reaction": "agree | disagree | neutral | question | answer"
        }
      ]
    }
  ],
  "participants": [
    {
      "name": "話者名",
      "summary": "この人の発言要旨"
    }
  ],
  "terms": [
    {
      "term": "専門用語",
      "definition": "その説明"
    }
  ],
  "keywords": [
    {
      "keyword": "キーワード",
      "priority": "high | medium | low"
    }
  ]
}
`;
const compose_prompt = (content) => {
    return `${exports.instruction}\n${exports.output_format}\n${content}`;
};
exports.compose_prompt = compose_prompt;
