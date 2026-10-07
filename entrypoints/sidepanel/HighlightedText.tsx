import type { ReactNode } from 'react';

// Renders text with case-insensitive occurrences of `query` wrapped in a
// mark; an empty query renders the text unchanged.
export default function HighlightedText({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const nodes: ReactNode[] = [];
  let from = 0;
  let idx = lower.indexOf(q);
  let key = 0;
  while (idx >= 0) {
    if (idx > from) nodes.push(text.slice(from, idx));
    nodes.push(
      <mark key={key++} className="rounded-sm bg-yellow-200 px-0.5 text-zinc-900">
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    from = idx + q.length;
    idx = lower.indexOf(q, from);
  }
  if (from < text.length) nodes.push(text.slice(from));
  return <>{nodes}</>;
}
