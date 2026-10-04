import { useCallback, useEffect, useState } from 'react';

import { detectPlatform, type SubtitleResult, type VideoPlatform } from '@/lib/subtitles';

interface SubsResult extends SubtitleResult {
  url: string;
}

function fmtTime(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

const PLATFORM_LABEL: Record<VideoPlatform, string> = {
  youtube: 'YouTube',
  bilibili: 'Bilibili',
};

// 字幕 tab: detects whether the active tab is a YouTube/Bilibili video,
// fetches its subtitles through the background worker, lists them with
// timestamps; clicking a line seeks the video.
export default function SubtitlesPanel() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<SubsResult | null>(null);
  const [tabId, setTabId] = useState<number | null>(null);
  const [tabUrl, setTabUrl] = useState('');

  const load = useCallback(async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    setTabId(tab?.id ?? null);
    const url = tab?.url ?? '';
    setTabUrl(url);
    if (!detectPlatform(url)) {
      setStatus('idle');
      setResult(null);
      return;
    }
    setStatus('loading');
    setError('');
    try {
      const r = (await browser.runtime.sendMessage({ type: 'fetchSubtitles', url, tabId })) as
        | (SubsResult & { ok?: boolean; error?: string })
        | undefined;
      if (!r?.ok) throw new Error(r?.error ?? 'no response');
      setResult({ ...r, url });
      setStatus('ready');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
    // Re-fetch when the active tab navigates to another page/video.
    const onUpdated = (id: number, info: { url?: string }) => {
      if (id === tabId && info.url && info.url !== tabUrl) void load();
    };
    browser.tabs.onUpdated.addListener(onUpdated);
    return () => browser.tabs.onUpdated.removeListener(onUpdated);
  }, [load, tabId, tabUrl]);

  const seek = async (start: number) => {
    if (tabId == null) return;
    try {
      await browser.scripting.executeScript({
        target: { tabId },
        func: (t: number) => {
          const video = document.querySelector('video');
          if (video) {
            video.currentTime = t;
            video.play();
          }
        },
        args: [start],
      });
    } catch {
      // Seeking is best-effort (e.g. the page blocks script injection).
    }
  };

  const detected = tabUrl ? detectPlatform(tabUrl) : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2">
        <span className="text-xs font-medium">字幕</span>
        <button
          type="button"
          onClick={() => void load()}
          className="ml-auto rounded-lg border border-zinc-300 px-2.5 py-1 text-[11px] text-zinc-600 transition-colors hover:bg-zinc-50"
        >
          刷新
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {status === 'idle' && (
          <p className="mt-6 text-center text-xs leading-relaxed text-zinc-400">
            当前标签页不是 YouTube/Bilibili 视频。
            <br />
            打开视频后点「刷新」获取字幕。
          </p>
        )}
        {status === 'loading' && <p className="text-xs text-zinc-400">获取字幕中…</p>}
        {status === 'error' && <p className="text-xs text-red-600">{error}</p>}
        {status === 'ready' && result && (
          <>
            <div className="mb-3">
              <p className="text-xs font-semibold text-zinc-900">{result.title || '未命名视频'}</p>
              <p className="mt-0.5 text-[10px] text-zinc-400">
                {PLATFORM_LABEL[result.platform]} · {result.lang || '未知语言'} ·{' '}
                {result.lines.length} 条字幕 （点击行跳转视频）
              </p>
            </div>
            <div className="space-y-0.5">
              {result.lines.map((line, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => void seek(line.start)}
                  className="flex w-full items-start gap-2 rounded-lg px-2 py-1 text-left transition-colors hover:bg-zinc-100"
                >
                  <span className="shrink-0 pt-px font-mono text-[10px] text-indigo-500">
                    {fmtTime(line.start)}
                  </span>
                  <span className="text-xs leading-relaxed text-zinc-700">{line.text}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
