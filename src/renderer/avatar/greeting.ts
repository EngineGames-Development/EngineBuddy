// The startup greeting (docs/PHASE-1.md step 10): after the fade-in, a few local lines (no
// tokens), then the bubble dismisses itself as usual. The avatar and the bubble both hear each
// line as an `eb-say` DOM event, so neither needs to know about the other.

export interface SayDetail {
  text: string;
  /** Add to what the bubble shows instead of replacing it. */
  append: boolean;
  /** The first line (the avatar waves on it). */
  first: boolean;
}

export const SAY_EVENT = 'eb-say';

/** Delay before the first line, then between lines (ms). */
export const GREETING_TIMING = { first: 1200, between: 1500 } as const;

export function say(detail: SayDetail): void {
  window.dispatchEvent(new CustomEvent<SayDetail>(SAY_EVENT, { detail }));
}

export function onSay(listener: (detail: SayDetail) => void): () => void {
  const handler = (e: Event) => listener((e as CustomEvent<SayDetail>).detail);
  window.addEventListener(SAY_EVENT, handler);
  return () => window.removeEventListener(SAY_EVENT, handler);
}

/** Plays the lines; returns a cancel function. `onFirst` fires when the first line shows. */
export function playGreeting(lines: readonly string[], onFirst?: () => void): () => void {
  const timers = lines.map((text, i) =>
    setTimeout(
      () => {
        say({ text, append: i > 0, first: i === 0 });
        if (i === 0) onFirst?.();
      },
      GREETING_TIMING.first + i * GREETING_TIMING.between,
    ),
  );
  return () => timers.forEach(clearTimeout);
}
