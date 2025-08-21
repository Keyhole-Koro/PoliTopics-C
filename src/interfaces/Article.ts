export interface Article {
  id: string;
  title: string;
  date: string;
  imageKind: "会議録" | "目次" | "索引" | "附録" | "追録";
  session: number;
  nameOfHouse: string;
  nameOfMeeting: string;
  category: string;
  description: string;

  summary: Summary;
  soft_summary: SoftSummary;
  middle_summary: MiddleSummary[];
  dialogs: Dialog[];
  participants: Participant[];
  keywords: Keyword[];
  terms: Term[];
}

export interface Summary {
  based_on_orders: number[];
  summary: string;
}

export interface SoftSummary {
  based_on_orders: number[];
  summary: string;
}

export interface MiddleSummary {
  based_on_orders: number[];
  summary: string;
}

export interface Participant {
  name: string;
  summary: string;
}

export interface Term {
  term: string;
  definition: string;
}

export interface Keyword {
  keyword: string;
  priority: "high" | "medium" | "low";
}

export interface Dialog {
  order: number;
  speaker: string;
  speaker_group: string;
  speaker_position: string;
  speaker_role: string;
  original_text: string;
  summary: string;
  soft_language: string;
}

export enum Reaction {
  AGREE = "agree",
  DISAGREE = "disagree",
  NEUTRAL = "neutral",
  QUESTION = "question",
  ANSWER = "answer"
}
