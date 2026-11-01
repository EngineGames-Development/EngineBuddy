// The chat history (userData/history): one JSON file per conversation. It listens to the same
// BuddyEvents as the avatar and bubble, so every turn ends up here no matter where you asked:
// bubble, chat window or menu. Each conversation remembers the agent's conversation ID, so opening
// an old one later continues it with full context.
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatMessage, ChatState, ChatToolLine, ImageAttachment } from '../../shared/chat';
import type { BuddyEvent } from '../../shared/events';

const MAX_CONVERSATIONS = 100;
const TITLE_LENGTH = 60;

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** The agent's conversation ID, for resuming. */
  agentSessionId?: string;
  messages: ChatMessage[];
}

interface PendingReply {
  text: string;
  tools: Map<string, ChatToolLine>;
}

const newId = () => randomUUID();

/** Same rule as the bubble: deltas usually carry the whole text already. */
function addFinalText(current: string, text: string): string {
  if (current.trimEnd().endsWith(text.trim())) return current;
  return current ? `${current.trimEnd()}\n\n${text}` : text;
}

export class ConversationStore {
  private readonly conversations = new Map<string, Conversation>();
  private activeId: string;
  private readonly pending = new Map<string, PendingReply>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly dir: string,
    /** The title of a conversation before its first message names it (in the UI language). */
    private readonly newTitle = 'New chat',
  ) {
    mkdirSync(dir, { recursive: true });
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      try {
        const c = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Conversation;
        if (typeof c.id === 'string' && Array.isArray(c.messages)) this.conversations.set(c.id, c);
      } catch {
        console.warn(`[history] skipped unreadable ${name}`);
      }
    }
    // Start where you left off.
    this.activeId = this.sorted()[0]?.id ?? this.create().id;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get active(): Conversation {
    return this.conversations.get(this.activeId) ?? this.create();
  }

  state(): ChatState {
    return {
      conversations: this.sorted().map(({ id, title, updatedAt }) => ({ id, title, updatedAt })),
      activeId: this.activeId,
      messages: this.active.messages,
    };
  }

  /** A fresh conversation, unless the current one is still empty. */
  startNew(): Conversation {
    if (this.active.messages.length === 0) return this.active;
    const c = this.create();
    this.changed();
    return c;
  }

  open(id: string): Conversation | undefined {
    const c = this.conversations.get(id);
    if (!c) return undefined;
    this.activeId = id;
    this.changed();
    return c;
  }

  delete(id: string): void {
    if (!this.conversations.delete(id)) return;
    rmSync(this.file(id), { force: true });
    if (id === this.activeId) this.activeId = this.sorted()[0]?.id ?? this.create().id;
    this.changed();
  }

  addUserMessage(text: string, images?: ImageAttachment[]): void {
    const c = this.active;
    if (c.messages.length === 0)
      c.title = text.replace(/\s+/g, ' ').trim().slice(0, TITLE_LENGTH) || 'Picture';
    this.push(c, { id: newId(), role: 'user', text, at: Date.now(), ...(images?.length ? { images } : {}) });
  }

  setAgentSessionId(sessionId: string | undefined): void {
    const c = this.active;
    if (!sessionId || c.agentSessionId === sessionId) return;
    c.agentSessionId = sessionId;
    this.save(c);
  }

  /** Feed every BuddyEvent here. */
  handle(event: BuddyEvent): void {
    switch (event.type) {
      case 'turn_start':
        this.pending.set(event.turnId, { text: '', tools: new Map() });
        return;
      case 'message_delta':
        this.reply(event.turnId).text += event.text;
        return;
      case 'message': {
        const r = this.reply(event.turnId);
        r.text = addFinalText(r.text, event.text);
        return;
      }
      case 'tool_start':
        this.reply(event.turnId).tools.set(event.callId, { label: event.description, ok: false });
        return;
      case 'tool_result': {
        const tool = this.reply(event.turnId).tools.get(event.callId);
        if (tool) tool.ok = event.success;
        return;
      }
      case 'agent_error':
        this.push(this.active, { id: newId(), role: 'error', text: event.message, at: Date.now() });
        return;
      case 'turn_end': {
        const r = this.pending.get(event.turnId);
        this.pending.delete(event.turnId);
        if (!r) return;
        const tools = [...r.tools.values()];
        const text = r.text.trim() || (event.outcome === 'cancelled' ? '(stopped)' : '');
        if (!text && !tools.length) return;
        this.push(this.active, {
          id: newId(),
          role: 'assistant',
          text,
          at: Date.now(),
          ...(tools.length ? { tools } : {}),
        });
        return;
      }
    }
  }

  private reply(turnId: string): PendingReply {
    let r = this.pending.get(turnId);
    if (!r) this.pending.set(turnId, (r = { text: '', tools: new Map() }));
    return r;
  }

  private push(c: Conversation, message: ChatMessage): void {
    c.messages.push(message);
    c.updatedAt = message.at;
    this.save(c);
    this.changed();
  }

  private create(): Conversation {
    const now = Date.now();
    const c: Conversation = {
      id: newId(),
      title: this.newTitle,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    this.conversations.set(c.id, c);
    this.activeId = c.id;
    this.prune();
    return c;
  }

  private sorted(): Conversation[] {
    return [...this.conversations.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private prune(): void {
    for (const old of this.sorted().slice(MAX_CONVERSATIONS)) {
      this.conversations.delete(old.id);
      rmSync(this.file(old.id), { force: true });
    }
  }

  private file(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private save(c: Conversation): void {
    try {
      const tmp = `${this.file(c.id)}.tmp`;
      writeFileSync(tmp, JSON.stringify(c));
      renameSync(tmp, this.file(c.id));
    } catch (error) {
      console.warn('[history] could not save:', error);
    }
  }

  private changed(): void {
    for (const l of this.listeners) l();
  }
}
