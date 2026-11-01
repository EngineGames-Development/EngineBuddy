import { Fragment, type ReactNode } from 'react';
import { parseMarkdown, type Inline } from './markdown';

// Renders the parsed subset as React elements. Every piece of model text ends up as a text
// node; nothing is ever set as HTML.
function renderInline(nodes: Inline[]): ReactNode {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'text':
        return <Fragment key={i}>{node.text}</Fragment>;
      case 'code':
        return <code key={i}>{node.text}</code>;
      case 'strong':
        return <strong key={i}>{renderInline(node.children)}</strong>;
      case 'em':
        return <em key={i}>{renderInline(node.children)}</em>;
    }
  });
}

export function MarkdownView({ text }: { text: string }) {
  return (
    <>
      {parseMarkdown(text).map((block, i) => {
        switch (block.type) {
          case 'p':
            return <p key={i}>{renderInline(block.children)}</p>;
          case 'code':
            return (
              <pre key={i}>
                <code>{block.text}</code>
              </pre>
            );
          case 'ul':
          case 'ol': {
            const List = block.type;
            return (
              <List key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </List>
            );
          }
        }
      })}
    </>
  );
}
