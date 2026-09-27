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
  onSpeak: () => void;
}

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

function SpeakerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

function SpeakButton({ onSpeak }: { onSpeak: () => void }) {
  return (
    <button
      type="button"
      onClick={onSpeak}
      aria-label="朗读单词"
      title="朗读单词"
      className="ml-auto shrink-0 rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
    >
      <SpeakerIcon />
    </button>
  );
}

export default function Card({
  selection,
  status,
  hit,
  errorText,
  addState,
  onAdd,
  onSpeak,
}: CardProps) {
  return (
    // Keep the page selection (and therefore this card) alive while the
    // user interacts with the card's buttons. Placement is up to the parent.
    <div className="w-80 font-sans" onMouseDown={(e) => e.preventDefault()}>
      <div className="rounded-xl border border-zinc-200 bg-white p-4 text-zinc-900 shadow-xl">
        {status === 'error' && <p className="text-sm text-red-600">{errorText}</p>}
        {status === 'pending' && <p className="text-sm text-zinc-400">查询中…</p>}
        {status === 'missing' && (
          <div className="flex items-center gap-2">
            <p className="text-lg font-semibold">{selection.word}</p>
            <p className="text-sm text-zinc-500">没查到</p>
            <SpeakButton onSpeak={onSpeak} />
          </div>
        )}
        {status === 'found' && hit && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                {hit.bucket.name}
              </span>
              <span className="text-xs text-zinc-400" title="在词本中的位置">
                #{hit.entry.position}
              </span>
              <span className="text-lg font-semibold">{hit.entry.word}</span>
              {hit.entry.ipa && <span className="text-sm text-zinc-500">{hit.entry.ipa}</span>}
              <SpeakButton onSpeak={onSpeak} />
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
