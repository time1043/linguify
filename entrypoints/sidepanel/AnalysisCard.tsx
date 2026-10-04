import type { SentenceAnalysis } from '@/lib/ai';

// Color scheme per grammatical role, roughly matching typical sentence-
// diagramming colors: 主语 purple, 谓语 green, 状语 blue, ...
const ROLE_STYLES: Record<string, { tag: string; chip: string }> = {
  主语: {
    tag: 'bg-violet-100 text-violet-700',
    chip: 'bg-violet-50 text-violet-900 border-violet-200',
  },
  谓语: { tag: 'bg-green-100 text-green-700', chip: 'bg-green-50 text-green-900 border-green-200' },
  宾语: { tag: 'bg-sky-100 text-sky-700', chip: 'bg-sky-50 text-sky-900 border-sky-200' },
  定语: { tag: 'bg-amber-100 text-amber-700', chip: 'bg-amber-50 text-amber-900 border-amber-200' },
  状语: { tag: 'bg-blue-100 text-blue-700', chip: 'bg-blue-50 text-blue-900 border-blue-200' },
  补语: { tag: 'bg-rose-100 text-rose-700', chip: 'bg-rose-50 text-rose-900 border-rose-200' },
};
const FALLBACK_STYLE = {
  tag: 'bg-zinc-100 text-zinc-600',
  chip: 'bg-zinc-50 text-zinc-800 border-zinc-200',
};

// The structured sentence-component visualization shown FIRST when a session
// opens: the sentence as colored grammar chips, then vocab and phrases.
export default function AnalysisCard({
  analysis,
  sourceUrl,
}: {
  analysis: SentenceAnalysis;
  sourceUrl: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        {analysis.chunks.map((c, i) => {
          const style = ROLE_STYLES[c.role] ?? FALLBACK_STYLE;
          return (
            <div key={i} className="flex flex-col items-center gap-0.5">
              <span className={`rounded px-1.5 py-px text-[9px] font-medium ${style.tag}`}>
                {c.role}
              </span>
              <span className={`rounded-lg border px-2 py-1 text-xs ${style.chip}`}>{c.text}</span>
            </div>
          );
        })}
      </div>

      {analysis.vocab.length > 0 && (
        <div className="mt-3 border-t border-zinc-100 pt-2">
          <p className="text-[10px] font-semibold text-zinc-500">生词</p>
          {analysis.vocab.map((v, i) => (
            <p key={i} className="mt-1 text-xs text-zinc-700">
              <span className="font-medium">{v.term}</span>
              <span className="text-zinc-400"> — </span>
              {v.meaning}
            </p>
          ))}
        </div>
      )}

      {analysis.phrases.length > 0 && (
        <div className="mt-3 border-t border-zinc-100 pt-2">
          <p className="text-[10px] font-semibold text-zinc-500">短语</p>
          {analysis.phrases.map((p, i) => (
            <p key={i} className="mt-1 text-xs text-zinc-700">
              {p}
            </p>
          ))}
        </div>
      )}

      {sourceUrl && (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 block truncate border-t border-zinc-100 pt-2 text-[10px] text-indigo-500 hover:underline"
        >
          来源：{sourceUrl}
        </a>
      )}
    </div>
  );
}
