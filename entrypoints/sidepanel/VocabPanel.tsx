import { useCallback, useEffect, useState } from 'react';

import type { MonthlyDoc } from '@/lib/monthly';

import { callOffscreen } from '@/lib/relay';

interface MonthInfo {
  name: string;
  count: number;
}

function describe(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'NO_DIR') return '未连接词库目录';
  if (message === 'NO_PERMISSION') return '词库目录需要重新授权';
  return message;
}

// Tab 2: the monthly word list. Months are read from
// _lib/vocab-monthly/YYYY-MM.json; picking a month shows its recorded words
// with provenance and every collected example.
export default function VocabPanel() {
  const [months, setMonths] = useState<MonthInfo[]>([]);
  const [month, setMonth] = useState('');
  const [doc, setDoc] = useState<MonthlyDoc | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState('');

  const read = useCallback(async (name: string) => {
    setStatus('loading');
    setError('');
    try {
      const { doc: read } = await callOffscreen<{ doc: MonthlyDoc | null }>({
        type: 'readMonthly',
        month: name,
      });
      setMonth(name);
      setDoc(read);
      setStatus('ready');
    } catch (err) {
      setStatus('error');
      setError(describe(err));
    }
  }, []);

  const refreshMonths = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      const { months: list } = await callOffscreen<{ months: MonthInfo[] }>({
        type: 'listMonthly',
      });
      setMonths(list);
      const [latest] = list;
      if (latest) await read(latest.name);
      else {
        setMonth('');
        setDoc(null);
        setStatus('ready');
      }
    } catch (err) {
      setStatus('error');
      setError(describe(err));
    }
  }, [read]);

  useEffect(() => {
    void refreshMonths();
  }, [refreshMonths]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2">
        <select
          value={month}
          onChange={(e) => void read(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-2 py-1.5 text-xs outline-none focus:border-indigo-500"
        >
          {months.length === 0 && <option value="">暂无月份</option>}
          {months.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name}（{m.count} 词）
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void refreshMonths()}
          className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-[11px] text-zinc-600 transition-colors hover:bg-zinc-50"
        >
          刷新
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {status === 'loading' && <p className="text-xs text-zinc-400">读取中…</p>}
        {status === 'error' && <p className="text-xs text-red-600">{error}</p>}
        {status === 'ready' && months.length === 0 && (
          <p className="mt-6 text-center text-xs leading-relaxed text-zinc-400">
            还没有生词记录。
            <br />
            在网页上选中单词，点卡片上的「加入月度」即可积累。
          </p>
        )}
        {(doc?.words ?? []).map((w) => (
          <div key={w.position} className="rounded-xl border border-zinc-200 bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-zinc-900">{w.word}</span>
              <span className="text-[10px] text-zinc-400">#{w.position}</span>
              {w.from && (
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-600">
                  {w.from}
                </span>
              )}
            </div>
            {(w.examples ?? (w.example ? [w.example] : [])).map((e, i) => (
              <div key={i} className="mt-2 border-t border-zinc-100 pt-2 first:border-0 first:pt-0">
                <p className="text-xs leading-relaxed text-zinc-700">{e.sentence}</p>
                {e.url && (
                  <a
                    href={e.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-0.5 block truncate text-[10px] text-indigo-500 hover:underline"
                  >
                    {e.url}
                  </a>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
