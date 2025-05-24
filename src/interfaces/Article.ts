type markdown = string;

export interface Article {
  id: string;
  title: string;
  date: string;
  imageKind: string;
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
  id: number;
  summary: string;
  figure: markdown;
}

export interface SoftSummary {
  id: number;
  summary: string;
}

export interface MiddleSummary {
  order: number;
  summary: string;
  figure: markdown;
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
  summary: string;
  soft_summary: string;
  response_to: ResponseTo[];
}

export interface ResponseTo {
  dialog_id: number;
  reaction: Reaction;
}

export enum Reaction {
  AGREE = "agree",
  DISAGREE = "disagree",
  NEUTRAL = "neutral",
  QUESTION = "question",
  ANSWER = "answer"
}