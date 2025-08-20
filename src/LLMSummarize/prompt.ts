export const instruction = `以下の会話内容をもとに、次の形式で要約データを構成してください:

各セクションとフィールドの**使用目的**を理解した上で、忠実に出力してください。  
この構造は、人間が読むレポートとしてだけでなく、システムが発言と要約を対応付けて処理できるように設計されています。

---

1. **基本情報 (Metadata)**  
 会議に関するメタデータを記載してください:タイトル、開催日、開催機関、カテゴリなど。  

2. **全体の要約 (Summary)**  
 会議全体の要点や結論を簡潔にまとめてください。  
 - \`based_on_orders\`: この要約がどの dialogs.order をまとめているかを配列で示す (例:[1,2,3])。  
 - \`summary\`: 会話全体の要点。  
 - \`figure\`: 補足的な図解 (任意)。  

3. **やさしい要約 (SoftSummary)**  
 政治や専門用語に馴染みのない読者向けに、背景や文脈も含めてわかりやすく丁寧に説明してください。  
 - \`based_on_orders\`: 対象となる dialogs.order の配列。  
 - \`summary\`: わかりやすく言い換えた文章。  

4. **中間要約 (MiddleSummary)**  
 議論の重要な転換点や話題ごとのまとまりを要約してください。構成順に並べてください。  
 - \`based_on_orders\`: どの dialogs.order に基づくか。  
 - \`summary\`: 中間的なまとめ。  
 - \`figure\`: 図や補足 (任意)。  

5. **発言ごとの要約 (Dialogs)**  
 各発言について、以下の情報を含めて記述してください:  
 - \`order\`: 発言番号。  
 - \`speaker\`: 発言者名。  
 - \`speaker_group\`: 所属。  
 - \`speaker_position\`: 役職。  
 - \`speaker_role\`: 役割 (質問者、答弁者など)。  
 - \`summary\`: 発言の主旨を簡潔に要約。  
 - \`soft_summary\`: 一般読者にも伝わるように、やさしく丁寧に言い換えた文章。  
 - \`response_to\`: この発言がどの発言に反応しているか (例:質問、賛同、反論など)。  

6. **参加者情報 (Participants)**  
 主な話者ごとに、名前・役職・発言内容の要旨をまとめてください。  

7. **用語の解説 (Terms)**  
 専門的または一般にはわかりにくい用語について、簡潔で明確な定義を記述してください。文脈に即した説明が望ましいです。  

8. **キーワード抽出 (Keywords)**  
 議論の焦点となる用語やトピックを抽出し、重要度 (high / medium / low)を分類してください。  

---
`;

export const output_format = `### 出力フォーマット

以下の形式に従ってJSONデータを作成してください:

{
  "id": "文字列 (議事録ID)",
  "title": "会議のタイトル",
  "date": "開催日 (YYYY-MM-DD)",
  "imageKind": "画像分類 (例: graph, diagram, etc.)",
  "session": 数字 (例: 208),
  "nameOfHouse": "衆議院または参議院",
  "nameOfMeeting": "会議名 (例: 国土交通委員会)",
  "category": "カテゴリ (例: 環境, 教育, etc.)",
  "description": "この会議についての説明",

  "summary": {
    "based_on_orders": [1,2,3],
    "summary": "会話全体の要約をここに記載",
    "figure": "Markdown形式で図や補足を記載 (任意)"
  },
  "soft_summary": {
    "based_on_orders": [1,2,3],
    "summary": "政治に詳しくない人でも分かるように、丁寧でわかりやすく説明した要約"
  },
  "middle_summary": [
    {
      "based_on_orders": [4,5],
      "summary": "中間要約1",
      "figure": "Markdown形式 (任意)"
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
      "soft_summary": "発言をやさしく丁寧に言い換えた内容",
      "response_to": [
        {
          "order": 0,
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

export const compose_prompt = (content: string): string => {
  return `${instruction}\n${output_format}\n${content}`;
};
