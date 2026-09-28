import type { ReactNode } from 'react';

import type { SelectionContext, SelectionKind } from './Card';

interface WordPinProps {
  selection: SelectionContext;
  // 'word' pins open the lookup card, 'ai' pins open the AI side panel.
  tone: SelectionKind;
  // Overrides the dot tooltip, e.g. when the side panel failed to open.
  hint?: string;
  active: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
  children?: ReactNode;
}

const PIN_SIZE = 20;
const PIN_GAP = 6;
const CARD_WIDTH = 320;

// A small floating dot anchored to the top-left corner of the selection.
// The word card only opens while the pointer stays inside the pin: the card
// is attached right below (or above) the dot with a pointer-transparent
// padding bridge, so moving between dot and card never closes it.
export default function WordPin({
  selection,
  tone,
  hint,
  active,
  onActivate,
  onDeactivate,
  children,
}: WordPinProps) {
  const { rect } = selection;
  const left = Math.min(Math.max(rect.left, 8), window.innerWidth - CARD_WIDTH - 40);
  const top =
    rect.top >= PIN_SIZE + PIN_GAP + 12 ? rect.top - PIN_SIZE - PIN_GAP : rect.bottom + PIN_GAP;

  const spaceBelow = window.innerHeight - top - PIN_SIZE - 16;
  const placeAbove = spaceBelow < 180;
  const maxHeight = placeAbove ? top - 16 : spaceBelow;
  const label = hint ?? (tone === 'sentence' ? 'AI 分析句子' : '查看释义');

  return (
    <div
      className="fixed z-[2147483647]"
      style={{ left, top, width: PIN_SIZE, height: PIN_SIZE }}
      // Keep the page selection (and therefore the pin) alive while the user
      // interacts with the dot or the card.
      onMouseDown={(e) => e.preventDefault()}
      onMouseLeave={active ? onDeactivate : undefined}
    >
      <button
        type="button"
        aria-label={label}
        title={label}
        onMouseEnter={onActivate}
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
