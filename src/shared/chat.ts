// The chat window's data: conversations as main stores them (userData/history), and what main
// pushes to the chat window. Plain types: main is the trusted side for main → renderer traffic.

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

/** A picture you send along: base64 without the `data:` prefix. Validated in main (./images.ts). */
export interface ImageAttachment {
  mediaType: ImageMediaType;
  data: string;
}

export interface ChatToolLine {
  label: string;
  ok: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'error';
  text: string;
  at: number;
  images?: ImageAttachment[];
  /** What EngineBuddy did during this reply (the activity list). */
  tools?: ChatToolLine[];
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: number;
}

export interface ChatState {
  conversations: ConversationSummary[];
  activeId: string;
  messages: ChatMessage[];
}

/** main → chat window. */
export type ChatPush =
  | { type: 'state'; state: ChatState }
  /** The screenshot you asked for, ready to send with your next message. */
  | { type: 'attachment'; image: ImageAttachment }
  | { type: 'notice'; text: string };
