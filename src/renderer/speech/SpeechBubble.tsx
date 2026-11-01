import { useEffect, useLayoutEffect, useReducer, useRef, useState, type FormEvent } from 'react';
import type { ImageAttachment } from '../../shared/chat';
import { MAX_INPUT_LENGTH } from '../../shared/commands';
import { MAX_IMAGES } from '../../shared/images';
import { imageFromFile, imageUrl } from '../common/images';
import { bubbleReducer, initialBubble, type Activity } from './bubble-model';
import { MarkdownView } from './MarkdownView';
import { onSay } from '../avatar/greeting';
import { chooseSide, placeBubble, workAreaInWindow, type Side } from './placement';
import './bubble.css';
import { t } from '../common/i18n';

interface Props {
  /** Bumped by the parent to open the bubble with the input focused (avatar click). */
  openSignal: number;
  /** Auto-dismiss delay once a turn is over. */
  dismissMs: number;
  scale: number;
}

const ICON: Record<Activity['status'], string> = { running: '●', done: '✓', failed: '✕' };

/** The work area of the screen this window is on, in the window's base coordinates. */
function currentWorkArea(scale: number) {
  const s = window.screen as Screen & { availLeft?: number; availTop?: number };
  return workAreaInWindow(
    { x: s.availLeft ?? 0, y: s.availTop ?? 0, width: s.availWidth, height: s.availHeight },
    { x: window.screenX, y: window.screenY },
    scale,
  );
}

export function SpeechBubble({ openSignal, dismissMs, scale }: Props) {
  const [state, dispatch] = useReducer(bubbleReducer, initialBubble);
  const [draft, setDraft] = useState('');
  const [pictures, setPictures] = useState<ImageAttachment[]>([]);
  const [hover, setHover] = useState(false);
  const [side, setSide] = useState<Side>('above');
  const [width, setWidth] = useState(0);
  const [, setLayoutTick] = useState(0);
  const bubble = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => window.buddy.onEvent((event) => dispatch({ type: 'event', event })), []);
  useEffect(() => onSay(({ text, append }) => dispatch({ type: 'say', text, append })), []);

  // Avatar click: open with the input focused. Focus once the open class has been committed,
  // because a `visibility: hidden` input can't take focus.
  const focusPending = useRef(false);
  useEffect(() => {
    if (!openSignal) return;
    focusPending.current = true;
    dispatch({ type: 'open' });
  }, [openSignal]);
  useEffect(() => {
    if (!state.open || !focusPending.current) return;
    focusPending.current = false;
    input.current?.focus();
  }, [state.open, openSignal]);

  // Pick above/below once per opening, so the bubble doesn't flip while text streams in.
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (state.open && !wasOpen.current) {
      setSide(chooseSide(currentWorkArea(scale)));
      stickToBottom.current = true;
    }
    wasOpen.current = state.open;
  }, [state.open, scale]);

  // The window may have moved (drag) or been rescaled; re-place on the next render.
  useEffect(() => {
    const bump = () => setLayoutTick((n) => n + 1);
    window.addEventListener('resize', bump);
    document.addEventListener('pointerup', bump);
    return () => {
      window.removeEventListener('resize', bump);
      document.removeEventListener('pointerup', bump);
    };
  }, []);

  useLayoutEffect(() => {
    const el = bubble.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.offsetWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Auto-dismiss once the turn is over, unless you're pointing at it or typing.
  useEffect(() => {
    if (!state.open || state.busy || hover || draft || pictures.length) return;
    const timer = setTimeout(() => dispatch({ type: 'close' }), dismissMs);
    return () => clearTimeout(timer);
  }, [state.open, state.busy, state.text, state.error, hover, draft, pictures, dismissMs]);

  // Follow the stream, unless you scrolled up to read.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [state.text, state.activities, state.narration, state.error]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && state.open) {
        dispatch({ type: 'close' });
        input.current?.blur();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [state.open]);

  const send = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim() || (pictures.length ? t('common.lookAtThis') : '');
    if (!text) return;
    window.buddy.send({
      type: 'user_input',
      text,
      source: 'bubble',
      ...(pictures.length ? { images: pictures } : {}),
    });
    setDraft('');
    setPictures([]);
  };

  // Pictures: paste (Ctrl+V) into the input, or drop them on the bubble.
  const addPictures = async (files: Iterable<File>) => {
    const images = [...files].filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;
    try {
      const added = await Promise.all(images.map(imageFromFile));
      setPictures((current) => [...current, ...added].slice(0, MAX_IMAGES));
      dispatch({ type: 'open' });
      input.current?.focus();
    } catch {
      dispatch({ type: 'say', text: t('common.pictureFailed'), append: false });
    }
  };

  const place = placeBubble(side, width || 240, currentWorkArea(scale));
  const hasBody =
    state.prompt || state.narration || state.activities.length > 0 || state.text || state.error || state.busy;

  return (
    <div
      ref={bubble}
      className={`bubble ${side}${state.open ? ' open' : ''}`}
      data-hit
      style={{ left: place.left, top: place.top, bottom: place.bottom }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void addPictures(e.dataTransfer.files);
      }}
    >
      {hasBody && (
        <div
          ref={scroller}
          className="bubble-body"
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
          }}
        >
          {state.prompt && <div className="prompt">{state.prompt}</div>}
          {state.narration && <div className="narration">{state.narration}</div>}
          {state.activities.length > 0 && (
            <ul className="activities">
              {state.activities.map((a) => (
                <li key={a.callId} className={a.status} title={a.summary}>
                  <span className="icon">{ICON[a.status]}</span>
                  {a.label}
                </li>
              ))}
            </ul>
          )}
          {state.text && (
            <div className="reply">
              <MarkdownView text={state.text} />
            </div>
          )}
          {state.busy && !state.text && <div className="typing" aria-label="thinking" />}
          {state.error && <div className="error">{state.error}</div>}
        </div>
      )}
      {pictures.length > 0 && (
        <div className="pictures">
          {pictures.map((img, i) => (
            <div key={i} className="thumb">
              <img src={imageUrl(img)} alt="" />
              <button
                type="button"
                title={t('common.remove')}
                onClick={() => setPictures((p) => p.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <form className="ask" onSubmit={send}>
        <input
          ref={input}
          value={draft}
          maxLength={MAX_INPUT_LENGTH}
          placeholder={state.busy ? t('bubble.followUp') : t('bubble.ask')}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={(e) => {
            const files = [...e.clipboardData.items]
              .filter((i) => i.kind === 'file')
              .map((i) => i.getAsFile())
              .filter((f): f is File => f !== null);
            if (files.some((f) => f.type.startsWith('image/'))) {
              e.preventDefault();
              void addPictures(files);
            }
          }}
          spellCheck={false}
        />
        <button
          type="button"
          className="expand"
          title={t('bubble.openChat')}
          onClick={() => window.buddy.send({ type: 'open_chat' })}
        >
          ⤢
        </button>
        {state.busy && (
          <button
            type="button"
            className="stop"
            title={t('common.stop')}
            onClick={() => window.buddy.send({ type: 'cancel_turn' })}
          >
            ■
          </button>
        )}
      </form>
      <div className="tail" style={{ left: place.tailX }} />
    </div>
  );
}
