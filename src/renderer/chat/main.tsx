// The chat window: your conversations with EngineBuddy, kept across restarts (main stores them),
// with pictures: paste (Ctrl+V), drop, or the camera button for a screenshot.
//
// Model text is rendered by MarkdownView as text nodes only, never as HTML. Pictures are shown
// from data: URLs main validated (or that we made ourselves on a canvas).
import { StrictMode, useEffect, useLayoutEffect, useReducer, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { ChatMessage, ChatState, ImageAttachment } from '../../shared/chat';
import { MAX_INPUT_LENGTH } from '../../shared/commands';
import { MAX_IMAGES } from '../../shared/images';
import { imageFromFile, imageUrl } from '../common/images';
import { MarkdownView } from '../speech/MarkdownView';
import { idle, liveReducer } from './live-turn';
import './chat.css';

const ICON = { running: '●', done: '✓', failed: '✕' } as const;

function when(at: number): string {
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function Message({ m }: { m: ChatMessage }) {
  return (
    <div className={`msg ${m.role}`}>
      {m.images && (
        <div className="pics">
          {m.images.map((img, i) => (
            <img key={i} src={imageUrl(img)} alt="" />
          ))}
        </div>
      )}
      {m.tools && (
        <ul className="tools">
          {m.tools.map((t, i) => (
            <li key={i} className={t.ok ? 'done' : 'failed'}>
              <span>{t.ok ? '✓' : '✕'}</span> {t.label}
            </li>
          ))}
        </ul>
      )}
      {m.text && (m.role === 'assistant' ? <MarkdownView text={m.text} /> : <p>{m.text}</p>)}
    </div>
  );
}

function Chat() {
  const [state, setState] = useState<ChatState>();
  const [live, dispatch] = useReducer(liveReducer, idle);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [notice, setNotice] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const offChat = window.buddy.onChat((push) => {
      if (push.type === 'state') setState(push.state);
      else if (push.type === 'attachment') attach([push.image]);
      else setNotice(push.text);
    });
    const offEvents = window.buddy.onEvent(dispatch);
    window.buddy.send({ type: 'chat_ready' });
    input.current?.focus();
    return () => {
      offChat();
      offEvents();
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(undefined), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [state?.messages, live]);

  // A new conversation always starts at the bottom.
  useLayoutEffect(() => {
    stick.current = true;
  }, [state?.activeId]);

  const attach = (images: ImageAttachment[]) =>
    setAttachments((current) => {
      const next = [...current, ...images].slice(0, MAX_IMAGES);
      if (current.length + images.length > MAX_IMAGES) setNotice(`Up to ${MAX_IMAGES} pictures per message.`);
      return next;
    });

  const addFiles = async (files: Iterable<File>) => {
    const pictures = [...files].filter((f) => f.type.startsWith('image/'));
    if (!pictures.length) return;
    try {
      attach(await Promise.all(pictures.map(imageFromFile)));
    } catch {
      setNotice("Couldn't read that picture.");
    }
  };

  const send = (e?: FormEvent) => {
    e?.preventDefault();
    const text = draft.trim() || (attachments.length ? 'Look at this.' : '');
    if (!text) return;
    window.buddy.send({
      type: 'user_input',
      text: text.slice(0, MAX_INPUT_LENGTH),
      source: 'chat',
      ...(attachments.length ? { images: attachments } : {}),
    });
    setDraft('');
    setAttachments([]);
    stick.current = true;
  };

  const showLive = live.busy && (live.text || live.tools.length || live.narration);

  return (
    <div
      className={`chat${dragging ? ' dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void addFiles(e.dataTransfer.files);
      }}
    >
      <aside>
        <button className="new" onClick={() => window.buddy.send({ type: 'chat_new' })}>
          + New chat
        </button>
        <ul className="conversations">
          {state?.conversations.map((c) => (
            <li
              key={c.id}
              className={c.id === state.activeId ? 'active' : ''}
              onClick={() => window.buddy.send({ type: 'chat_open', id: c.id })}
              title={c.title}
            >
              <span className="title">{c.title}</span>
              <span className="when">{when(c.updatedAt)}</span>
              <button
                className="delete"
                title="Delete this chat"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete "${c.title}"?`)) window.buddy.send({ type: 'chat_delete', id: c.id });
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <button className="settings" onClick={() => window.buddy.send({ type: 'open_settings' })}>
          ⚙ Settings
        </button>
      </aside>

      <main>
        <div
          ref={scroller}
          className="messages"
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
        >
          {state && state.messages.length === 0 && !live.busy && (
            <div className="empty">
              <p>Hey. What are we building today?</p>
              <p className="hint">Paste a picture with Ctrl+V, drop one here, or use 📷 for a screenshot.</p>
            </div>
          )}
          {state?.messages.map((m) => (
            <Message key={m.id} m={m} />
          ))}
          {live.busy && (
            <div className="msg assistant live">
              {live.narration && <div className="narration">{live.narration}</div>}
              {live.tools.length > 0 && (
                <ul className="tools">
                  {live.tools.map((t) => (
                    <li key={t.callId} className={t.status}>
                      <span>{ICON[t.status]}</span> {t.label}
                    </li>
                  ))}
                </ul>
              )}
              {live.text && <MarkdownView text={live.text} />}
              {!showLive && <div className="typing" aria-label="thinking" />}
            </div>
          )}
        </div>

        {notice && <div className="notice">{notice}</div>}

        <form className="composer" onSubmit={send}>
          {attachments.length > 0 && (
            <div className="attachments">
              {attachments.map((img, i) => (
                <div key={i} className="thumb">
                  <img src={imageUrl(img)} alt="" />
                  <button
                    type="button"
                    title="Remove"
                    onClick={() => setAttachments((a) => a.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="row">
            <button
              type="button"
              className="icon"
              title="Take a screenshot (this window hides for a moment)"
              onClick={() => window.buddy.send({ type: 'take_screenshot' })}
            >
              📷
            </button>
            <textarea
              ref={input}
              value={draft}
              rows={1}
              maxLength={MAX_INPUT_LENGTH}
              placeholder="Message EngineBuddy…  (Enter sends, Shift+Enter new line)"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) send(e);
              }}
              onPaste={(e) => {
                const files = [...e.clipboardData.items]
                  .filter((i) => i.kind === 'file')
                  .map((i) => i.getAsFile())
                  .filter((f): f is File => f !== null);
                if (files.some((f) => f.type.startsWith('image/'))) {
                  e.preventDefault();
                  void addFiles(files);
                }
              }}
            />
            {live.busy ? (
              <button
                type="button"
                className="stop"
                title="Stop"
                onClick={() => window.buddy.send({ type: 'cancel_turn' })}
              >
                ■
              </button>
            ) : (
              <button type="submit" className="send" disabled={!draft.trim() && !attachments.length}>
                Send
              </button>
            )}
          </div>
        </form>
      </main>
      {dragging && <div className="dropzone">Drop the picture to attach it</div>}
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('chat/index.html is missing #root');
createRoot(root).render(
  <StrictMode>
    <Chat />
  </StrictMode>,
);
