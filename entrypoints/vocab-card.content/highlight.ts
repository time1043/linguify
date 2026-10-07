// Locate a stored sentence inside the page and highlight it with the CSS
// Custom Highlight API (no DOM mutation, so React-heavy pages stay intact).
// Stored sentences are whitespace-normalized, so the page text is streamed
// through the same normalization with a map back to the source text nodes.

type SourcePos = { node: Text; offset: number };

const HIGHLIGHT_NAME = 'linguify-highlight';

// Whitespace-normalized concatenation of every visible text node, with a map
// from each normalized character back to its (node, offset). Element
// boundaries count as whitespace so sentences spanning inline elements still
// match; mid-word inline tags (rare) simply fail to match.
function buildStream(): { stream: string; positions: SourcePos[] } {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const positions: SourcePos[] = [];
  let stream = '';
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const parent = node.parentElement;
    if (!parent || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/.test(parent.tagName)) continue;
    if (stream.length > 0 && !stream.endsWith(' ')) {
      stream += ' ';
      positions.push({ node, offset: 0 });
    }
    const text = node.data;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charAt(i);
      if (/\s/.test(ch)) {
        if (stream.length === 0 || stream.endsWith(' ')) continue;
        stream += ' ';
      } else {
        stream += ch;
      }
      positions.push({ node, offset: i });
    }
  }
  return { stream, positions };
}

function ensureStyle(): void {
  if (document.getElementById('linguify-highlight-style')) return;
  const style = document.createElement('style');
  style.id = 'linguify-highlight-style';
  style.textContent = `::highlight(${HIGHLIGHT_NAME}){background-color:rgba(250,204,21,.45)}`;
  (document.head ?? document.body).append(style);
}

export function clearSentenceHighlight(): void {
  CSS.highlights.delete(HIGHLIGHT_NAME);
}

// True when url is this page (origin + path; hash/query differences ignored).
export function samePage(url: string): boolean {
  try {
    const a = new URL(location.href);
    const b = new URL(url);
    return a.origin === b.origin && a.pathname === b.pathname;
  } catch {
    return false;
  }
}

// Highlight the sentence on this page (the caller has already checked
// samePage) and scroll to it. Returns false when the text is gone.
export function highlightSentenceHere(sentence: string): boolean {
  clearSentenceHighlight();
  const needle = sentence.replace(/\s+/g, ' ').trim();
  if (!needle) return false;
  const { stream, positions } = buildStream();
  const idx = stream.indexOf(needle);
  if (idx < 0 || idx + needle.length > positions.length) return false;
  const start = positions[idx]!;
  const end = positions[idx + needle.length - 1]!;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset + 1);
  ensureStyle();
  CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(range));
  (range.startContainer.parentElement ?? document.body).scrollIntoView({
    behavior: 'smooth',
    block: 'center',
  });
  return true;
}
