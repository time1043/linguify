import type { ReactNode } from 'react';

import type { SelectionContext, SelectionKind } from './Card';

interface WordPinProps {
  selection: SelectionContext;
  // 'word' pins open the lookup card, 'sentence' pins open the AI sidebar.
  tone: SelectionKind;
  // Overrides the dot tooltip.
  hint?: string;
  active: boolean;
  // Word pins open on hover; sentence pins wait for a click (the AI sidebar
  // is too large to pop open on an accidental hover).
  activateOnHover?: boolean;
  onActivate: () => void;
  children?: ReactNode;
}

const PIN_SIZE = 20;
const PIN_GAP = 6;
const CARD_WIDTH = 320;

// A small floating dot anchored to the top-left corner of the selection.
// Activating it opens the card pinned: the card stays until a click outside
// it (handled in App), Escape, a scroll, or a new selection — never when the
// pointer merely wanders off the dot.
export default function WordPin({
  selection,
  tone,
  hint,
  active,
  activateOnHover = true,
  onActivate,
  children,
}: WordPinProps) {
  const { rect } = selection;
  const left = Math.min(Math.max(rect.left, 8), window.innerWidth - CARD_WIDTH - 40);
  const top =
    rect.top >= PIN_SIZE + PIN_GAP + 12 ? rect.top - PIN_SIZE - PIN_GAP : rect.bottom + PIN_GAP;

  const spaceBelow = window.innerHeight - top - PIN_SIZE - 16;
  const placeAbove = spaceBelow < 180;
  const maxHeight = placeAbove ? top - 16 : spaceBelow;
  const label = hint ?? (tone === 'sentence' ? 'AI 分析句子（点击）' : '查看释义');

  return (
    <div
      className="fixed z-[2147483647]"
      style={{ left, top, width: PIN_SIZE, height: PIN_SIZE }}
      // Keep the page selection (and therefore the pin) alive while the user
      // interacts with the dot or the card.
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        type="button"
        aria-label={label}
        title={label}
        onMouseEnter={activateOnHover ? onActivate : undefined}
        onClick={onActivate}
        className={`h-5 w-5 rounded-full shadow-lg ring-2 ring-white transition-transform hover:scale-110 ${
          tone === 'sentence' ? 'bg-violet-600' : 'bg-indigo-600'
        } ${active ? 'opacity-70' : ''}`}
      />
      {active && (
        <div
          className="absolute left-0 w-80 overflow-y-auto"
          style={
            placeAbove
              ? { bottom: PIN_SIZE, paddingBottom: 8, maxHeight }
              : { top: PIN_SIZE, paddingTop: 8, maxHeight }
          }
        >
          {children}
        </div>
      )}
    </div>
  );
}
