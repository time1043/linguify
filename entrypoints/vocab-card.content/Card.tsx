import type { LookupHit } from '@/lib/types';

export interface SelectionContext {
  word: string;
  rect: { top: number; left: number; right: number; bottom: number };
  sentence: string;
  url: string;
}

export type CardStatus = 'pending' | 'found' | 'missing' | 'error';
export type AddState = 'idle' | 'adding' | 'added' | 'exists' | 'error';

interface CardProps {
  selection: SelectionContext;
  status: CardStatus;
  hit: LookupHit | null;
  errorText: string;
  addState: AddState;
  onAdd: () => void;
}

const CARD_GAP = 8;

const ADD_LABELS: Record<AddState, string> = {
  idle: '加入月度',
  adding: '添加中…',
  added: '✓ 已加入',
  exists: '已在月度中',
  error: '添加失败，重试',
};

const ADD_CLASSES: Record<AddState, string> = {
  idle: 'bg-indigo-600 text-white hover:bg-indigo-500',
  adding: 'bg-indigo-300 text-white',
  added: 'bg-green-100 text-green-700',
  exists: 'bg-zinc-100 text-zinc-500',
  error: 'bg-red-100 text-red-700 hover:bg-red-200',
};

export default function Card({ selection, status, hit, errorText, addState, onAdd }: CardProps) {
  const { rect } = selection;
  // Prefer below the selection; flip above when near the viewport bottom.
  const flip = window.innerHeight - rect.bottom < 200;
  const left = Math.min(Math.max(rect.left, 8), window.innerWidth - 328);

  return (
    <div
      className="fixed z-[2147483647] w-80 font-sans"
      style={
        flip
          ? { left, bottom: window.innerHeight - rect.top + CARD_GAP }
          : { left, top: rect.bottom + CARD_GAP }
      }
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="rounded-xl border border-zinc-200 bg-white p-4 text-zinc-900 shadow-xl">
        {status === 'error' && <p className="text-sm text-red-600">{errorText}</p>}
        {status === 'pending' && <p className="text-sm text-zinc-400">查询中…</p>}
        {status === 'missing' && (
          <>
            <p className="text-lg font-semibold">{selection.word}</p>
            <p className="mt-1 text-sm text-zinc-500">没查到</p>
          </>
        )}
        {status === 'found' && hit && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                {hit.bucket}
              </span>
              <span className="text-xs text-zinc-400" title="在词本中的位置">
                #{hit.entry.position}
              </span>
              <span className="text-lg font-semibold">{hit.entry.word}</span>
              {hit.entry.ipa && <span className="text-sm text-zinc-500">{hit.entry.ipa}</span>}
            </div>
            {hit.entry.meaning && (
              <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap">
                {hit.entry.meaning}
              </p>
            )}
            {hit.entry.forms.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {hit.entry.forms.map((form) => (
                  <span
                    key={form}
                    className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600"
                  >
                    {form}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
        <div className="mt-3 flex items-center justify-end">
          <button
            type="button"
            disabled={addState === 'adding'}
            onClick={onAdd}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${ADD_CLASSES[addState]}`}
          >
            {ADD_LABELS[addState]}
          </button>
        </div>
      </div>
    </div>
  );
}
