export interface PluralMessage {
  readonly zero?: string;
  readonly one?: string;
  readonly two?: string;
  readonly few?: string;
  readonly many?: string;
  readonly other: string;
}

export type MessageValue = string | PluralMessage;
