// The confirmation window (SECURITY.md §5). What it shows comes from the tool's validated input
// (the literal command, the folder); the model's own explanation is shown separately and labelled.
//
// Cancel is the default: it has focus, Enter and Esc both mean no, and closing the window means no.
// Allow needs a mouse click, or Tab to it and Space, and is disabled for the first moments.
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ConfirmationRequest, DiffLine } from '../../shared/events';
import './confirm.css';

interface Pending {
  id: string;
  request: ConfirmationRequest;
  timeoutMs: number;
  allowDelayMs: number;
}

const SIGN: Record<DiffLine['kind'], string> = { same: ' ', add: '+', del: '-', gap: '⋯' };

function readPending(): Pending | undefined {
  try {
    return JSON.parse(new URLSearchParams(window.location.search).get('pending') ?? '') as Pending;
  } catch {
    return undefined;
  }
}

function Confirm({ pending }: { pending: Pending }) {
  const { id, request, timeoutMs, allowDelayMs } = pending;
  const [armed, setArmed] = useState(false);
  const [left, setLeft] = useState(Math.round(timeoutMs / 1000));
  const [answered, setAnswered] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);

  const answer = (allowed: boolean) => {
    if (answered || (allowed && !armed)) return;
    setAnswered(true);
    window.buddy.confirm.answer(id, allowed);
  };

  useEffect(() => {
    cancel.current?.focus();
    const arm = setTimeout(() => setArmed(true), allowDelayMs);
    const start = Date.now();
    const tick = setInterval(
      () => setLeft(Math.max(0, Math.round((timeoutMs - (Date.now() - start)) / 1000))),
      500,
    );
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') answer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(arm);
      clearInterval(tick);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div className="confirm">
      <header>
        <span className="dot" />
        <h1>{request.title}</h1>
        <span className="timer" title="Says no by itself when this runs out">
          {left}s
        </span>
      </header>

      <pre className={`target${request.diff ? ' path' : ''}`}>{request.target}</pre>

      {request.diff && (
        <div className="diff" role="table" aria-label="The change">
          {request.diff.map((line, i) => (
            <div key={i} className={line.kind}>
              <span className="sign">{SIGN[line.kind]}</span>
              {line.text || ' '}
            </div>
          ))}
        </div>
      )}

      <ul className="details">
        {request.details.map((d) => (
          <li key={d}>{d}</li>
        ))}
      </ul>

      {request.modelExplanation && (
        <div className="explanation">
          <span>EngineBuddy says:</span> {request.modelExplanation}
        </div>
      )}

      <footer>
        <button ref={cancel} className="cancel" onClick={() => answer(false)} disabled={answered}>
          Cancel
        </button>
        <button
          className="allow"
          disabled={!armed || answered}
          onClick={() => answer(true)}
          // Enter never allows (SECURITY.md §5); Space on a focused button still does.
          onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
        >
          Allow
        </button>
      </footer>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('confirm/index.html is missing #root');
const pending = readPending();

createRoot(root).render(
  <StrictMode>
    {pending ? <Confirm pending={pending} /> : <p className="confirm">Nothing to confirm.</p>}
  </StrictMode>,
);
