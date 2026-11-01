// The bubble's Markdown subset (ARCHITECTURE.md §8.3): paragraphs, bullet and numbered lists,
// fenced code blocks, **bold**, *italic* and `inline code`. It parses into a small tree that React
// renders as text nodes, so model output can never become HTML (SECURITY.md §1, "renderer
// compromise"). Anything it doesn't understand, including links, stays literal text.
// It has to cope with half-streamed input: an unclosed `**` or ``` just renders as written.

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'code'; text: string };

export type Block =
  | { type: 'p'; children: Inline[] }
  | { type: 'ul' | 'ol'; items: Inline[][] }
  | { type: 'code'; text: string };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const FENCE = /^\s*```/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'p', children: parseInline(paragraph.join(' ')) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    if (FENCE.test(line)) {
      const end = lines.findIndex((l, j) => j > i && FENCE.test(l));
      // Unclosed fence while streaming: show everything after it as code so far.
      const body = lines.slice(i + 1, end === -1 ? undefined : end);
      flush();
      blocks.push({ type: 'code', text: body.join('\n') });
      if (end === -1) break;
      i = end;
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flush();
      const kind = bullet ? 'ul' : 'ol';
      const last = blocks.at(-1);
      const item = parseInline((bullet ?? numbered)?.[1] ?? '');
      if (last && last.type === kind) last.items.push(item);
      else blocks.push({ type: kind, items: [item] });
      continue;
    }

    if (line.trim() === '') flush();
    else paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

/** Inline spans. Code first (its content is literal), then bold, then italic. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest) {
    const match =
      /`([^`]+)`|\*\*(.+?)\*\*|(?<![*\w])\*(?!\s)(.+?)(?<!\s)\*(?![*\w])|_(?!\s)(.+?)(?<!\s)_(?!\w)/.exec(
        rest,
      );
    if (!match) {
      out.push({ type: 'text', text: rest });
      break;
    }
    if (match.index > 0) out.push({ type: 'text', text: rest.slice(0, match.index) });
    const [whole, code, bold, star, underscore] = match;
    if (code !== undefined) out.push({ type: 'code', text: code });
    else if (bold !== undefined) out.push({ type: 'strong', children: parseInline(bold) });
    else out.push({ type: 'em', children: parseInline(star ?? underscore ?? '') });
    rest = rest.slice(match.index + whole.length);
  }
  return out;
}
