import { useCallback, useEffect, useRef, useState } from 'react';

import type { MonthlyDoc, MonthlyEntry } from '@/lib/monthly';

import { callOffscreen } from '@/lib/relay';

import HighlightedText from './HighlightedText';

interface MonthInfo {
  name: string;
  count: number;
}

function describe(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'NO_DIR') return '未连接词库目录';
  if (message === 'NO_PERMISSION') return '词库目录需要重新授权（点击面板任意位置即可恢复）';
  return message;
}

// Word entries of the months already fetched this panel session, so repeated
// searches do not re-read the files.
type DocsCache = Map<string, MonthlyEntry[]>;

// A search hit: the word entry plus the month it was saved in.
interface SearchHit {
  month: string;
  word: MonthlyEntry;
}

function entryMatches(w: MonthlyEntry, q: string): boolean {
  if (w.word.toLowerCase().includes(q)) return true;
  return (w.examples ?? (w.example ? [w.example] : [])).some((e) =>
    e.sentence.toLowerCase().includes(q),
  );
}

// Tab 2: the monthly word list. Months are read from
// _lib/vocab-monthly/YYYY-MM.json; picking a month shows its recorded words
// with provenance and every collected example. A query searches across ALL
// months (word text and example sentences), loading the month files on
// demand and caching them for the panel session.
export default function VocabPanel() {
  const [months, setMonths] = useState<MonthInfo[]>([]);
  const [month, setMonth] = useState('');
  const [doc, setDoc] = useState<MonthlyDoc | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const docsCache = useRef<DocsCache>(new Map());
  const searchSeq = useRef(0);

  const read = useCallback(async (name: string) => {
    setStatus('loading');
    setError('');
    try {
      const { doc: read } = await callOffscreen<{ doc: MonthlyDoc | null }>({
        type: 'readMonthly',
        month: name,
      });
      docsCache.current.set(name, read?.words ?? []);
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
    docsCache.current = new Map();
    setHits(null);
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

  // Cross-month search: fetch the months not cached yet, then filter.
  const runSearch = useCallback(
    async (raw: string) => {
      const q = raw.trim().toLowerCase();
      const seq = ++searchSeq.current;
      if (!q || months.length === 0) {
        setHits(null);
        setSearching(false);
        return;
      }
      setSearching(true);
      try {
        const missing = months.filter((m) => !docsCache.current.has(m.name));
        const fetched = await Promise.all(
          missing.map(async (m) => {
            const { doc } = await callOffscreen<{ doc: MonthlyDoc | null }>({
              type: 'readMonthly',
              month: m.name,
            });
            return [m.name, doc?.words ?? []] as const;
          }),
        );
        if (seq !== searchSeq.current) return;
        for (const [name, words] of fetched) docsCache.current.set(name, words);
        const found: SearchHit[] = [];
        for (const m of months) {
          for (const w of docsCache.current.get(m.name) ?? []) {
            if (entryMatches(w, q)) found.push({ month: m.name, word: w });
          }
        }
        setHits(found);
      } catch (err) {
        if (seq !== searchSeq.current) return;
        setError(describe(err));
        setHits([]);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    },
    [months],
  );

  // Debounced so fast typing triggers one pass, not one per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => void runSearch(query), 250);
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  const q = query.trim();
  const isSearch = q.length > 0;
  const card = (w: MonthlyEntry, month?: string, key?: string) => (
    <div key={key ?? w.position} className="rounded-xl border border-zinc-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-zinc-900">
          <HighlightedText text={w.word} query={q} />
        </span>
        <span className="text-[10px] text-zinc-400">#{w.position}</span>
        {month && (
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-500">
            {month}
          </span>
        )}
        {w.from && (
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-600">
            {w.from}
          </span>
        )}
      </div>
      {(w.examples ?? (w.example ? [w.example] : [])).map((e, i) => (
        <div key={i} className="mt-2 border-t border-zinc-100 pt-2 first:border-0 first:pt-0">
          <p className="text-xs leading-relaxed text-zinc-700">
            <HighlightedText text={e.sentence} query={q} />
          </p>
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
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2">
        <select
          value={month}
          onChange={(e) => {
            setQuery('');
            void read(e.target.value);
          }}
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

      <div className="border-b border-zinc-200 px-3 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索单词或例句（跨月份）…"
          className="w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-xs outline-none focus:border-indigo-500"
        />
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {status === 'loading' && <p className="text-xs text-zinc-400">读取中…</p>}
        {status === 'error' && <p className="text-xs text-red-600">{error}</p>}
        {!isSearch && status === 'ready' && months.length === 0 && (
          <p className="mt-6 text-center text-xs leading-relaxed text-zinc-400">
            还没有生词记录。
            <br />
            在网页上选中单词，点卡片上的「加入月度」即可积累。
          </p>
        )}
        {!isSearch && (doc?.words ?? []).map((w) => card(w))}
        {isSearch && (searching || hits === null) && (
          <p className="text-xs text-zinc-400">搜索中…</p>
        )}
        {isSearch && !searching && hits !== null && hits.length === 0 && (
          <p className="mt-6 text-center text-xs text-zinc-400">没有匹配的生词。</p>
        )}
        {isSearch && hits?.map(({ month: m, word: w }) => card(w, m, `${m}-${w.position}`))}
      </div>
    </div>
  );
}
