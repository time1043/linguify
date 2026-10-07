// Subtitles tab. Subtitles come from files the user downloaded themselves, laid
// out inside the vocabulary-bucket repo under
// _lib/subtitles/<platform>/<uploader>/<title>.srt, with a per-platform
// map.json recording the videoId -> file mapping — this panel resolves that
// file for the active tab's video and keeps the list in sync with the
// page's <video> element (see entrypoints/subtitles.content.ts, which owns
// playback and the hotkeys).

import { useCallback, useEffect, useRef, useState } from 'react';

import { bucketDirAccessible, getBucketDir } from '@/lib/fsa';
import {
  findLocalSubtitleFile,
  formatSubtitleTime,
  MAX_RATE,
  MIN_RATE,
  parseSubtitleText,
  RATE_STEP,
  type SubtitleCue,
  type SubtitleCommand,
  type SubtitlesLoopState,
} from '@/lib/subtitles';

import { useActiveVideo, type MessageSender } from './use-active-video';
import { useBucketDir } from './use-bucket-dir';

// Codes the panel itself maps to guidance; anything else is shown verbatim.
type LoadError = 'NO_DIR' | 'NO_PERMISSION' | 'NOT_FOUND' | 'EMPTY' | string;

export default function SubtitlesPanel({ active }: { active: boolean }) {
  const { activeTabId, video, connectionLost, sendToTab } = useActiveVideo();
  const { dirState, pick, regrant, reportPrompt, tick } = useBucketDir();
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [subtitlePath, setSubtitlePath] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [pendingAIdx, setPendingAIdx] = useState<number | null>(null);
  const [loop, setLoop] = useState<SubtitlesLoopState | null>(null);
  const [rate, setRate] = useState(1);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Switching tabs drops the previous video's list state; the hook asks the
  // new tab's content script to announce itself.
  useEffect(() => {
    setCues([]);
    setSubtitlePath(null);
    setLoadError(null);
    setCurrentIdx(-1);
    setLoop(null);
    setPendingAIdx(null);
    setPlaying(false);
    setRate(1);
  }, [activeTabId]);

  // Playback state broadcasts from the content script, filtered to the
  // active tab (video announcements are handled by useActiveVideo).
  useEffect(() => {
    const onMessage = (message: unknown, sender: MessageSender): undefined => {
      const tabId = sender.tab?.id;
      if (tabId == null || tabId !== activeTabId) return;
      const msg = message as
        | {
            type?: string;
            videoId?: string;
            currentIdx?: number;
            playing?: boolean;
            pendingAIdx?: number | null;
            loop?: SubtitlesLoopState | null;
            rate?: number;
          }
        | undefined;
      if (msg?.type === 'subtitlesState') {
        setCurrentIdx(msg.currentIdx ?? -1);
        setPlaying(msg.playing ?? false);
        setPendingAIdx(msg.pendingAIdx ?? null);
        setLoop(msg.loop ?? null);
        setRate(msg.rate ?? 1);
      }
      return undefined;
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }, [activeTabId]);

  // Load (or reload) the subtitle file whenever the video changes.
  const videoId = video?.info.videoId;
  const platform = video?.info.platform;
  useEffect(() => {
    if (!video || !videoId || !platform) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setCues([]);
    setSubtitlePath(null);
    void (async () => {
      try {
        const dir = await getBucketDir();
        if (!dir) {
          if (!cancelled) setLoadError('NO_DIR');
          return;
        }
        if (!(await bucketDirAccessible(dir))) {
          if (!cancelled) {
            // Reported to the shared hook so the auto-restore re-arms.
            reportPrompt();
            setLoadError('NO_PERMISSION');
          }
          return;
        }
        const file = await findLocalSubtitleFile(dir, platform, videoId);
        if (!file) {
          if (!cancelled) setLoadError('NOT_FOUND');
          return;
        }
        const parsed = parseSubtitleText(file.text);
        if (parsed.length === 0) {
          if (!cancelled) setLoadError('EMPTY');
          return;
        }
        if (cancelled) return;
        setCues(parsed);
        setSubtitlePath(file.path);
        await sendToTab({ type: 'subtitlesSetCues', videoId, cues: parsed });
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [video, videoId, platform, tick, sendToTab]);

  const runCommand = useCallback(
    (cmd: SubtitleCommand): void => {
      if (!video) return;
      void sendToTab({ type: 'subtitlesCommand', videoId: video.info.videoId, cmd }).catch(
        () => undefined,
      );
    },
    [video, sendToTab],
  );

  const seekTo = useCallback(
    (time: number): void => {
      if (!video) return;
      void sendToTab({ type: 'subtitlesSeek', videoId: video.info.videoId, time }).catch(
        () => undefined,
      );
    },
    [video, sendToTab],
  );

  // The same study hotkeys as on the page, so they work while the focus is
  // in the panel (e.g. right after clicking a line). Bound only while this
  // tab is in front — all panels stay mounted, and two tabs both listening
  // would double-handle every key.
  useEffect(() => {
    if (!active) return;
    const keyCommands: Record<string, SubtitleCommand> = {
      a: 'prev',
      d: 'next',
      s: 'toggleSingle',
      z: 'markA',
      x: 'markB',
      j: 'rateDown',
      l: 'rateUp',
      k: 'resetRate',
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)))
        return;
      // Space toggles playback instead of re-activating the focused row
      // (a clicked row keeps focus, and space would otherwise "click" it
      // again, restarting that line) or scrolling the list.
      if (e.key === ' ') {
        if (!video) return;
        e.preventDefault();
        runCommand('togglePlay');
        return;
      }
      const cmd = keyCommands[e.key.toLowerCase()];
      if (!cmd) return;
      // Holding a/d walks lines and j/l ramps the rate; marking keys must
      // not auto-repeat.
      if (e.repeat && cmd !== 'prev' && cmd !== 'next' && cmd !== 'rateUp' && cmd !== 'rateDown')
        return;
      e.preventDefault();
      runCommand(cmd);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, runCommand]);

  // Follow playback: keep the current line centered in the list, like a
  // lyrics view. Scrolling the container directly (instead of
  // scrollIntoView) so ancestor scrollables never move.
  const centerCurrentRow = useCallback((idx: number): void => {
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector<HTMLElement>(`[data-idx="${idx}"]`);
    if (!row) return;
    const listRect = list.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const delta = rowRect.top + rowRect.height / 2 - (listRect.top + listRect.height / 2);
    list.scrollTop += delta;
  }, []);

  useEffect(() => {
    centerCurrentRow(currentIdx);
  }, [currentIdx, cues, centerCurrentRow]);

  const inLoopRange = useCallback(
    (idx: number): boolean => loop != null && idx >= loop.aIdx && idx <= loop.lastIdx,
    [loop],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-white text-xs text-zinc-800">
      {/* current video */}
      <div className="border-b border-zinc-200 px-3 py-2">
        {video ? (
          <>
            <div className="flex items-center gap-2">
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-white">
                {video.info.platform}
              </span>
              <span className="font-mono text-[10px] text-zinc-500">{video.info.videoId}</span>
              <span
                className={`ml-auto text-[10px] ${playing ? 'text-green-600' : 'text-zinc-400'}`}
              >
                {playing ? '▶ 播放中' : '⏸ 已暂停'}
              </span>
            </div>
            <div className="mt-1 truncate text-[11px] text-zinc-600" title={video.info.title}>
              {video.info.title}
            </div>
            {/* Playback rate: a notched slider (0.5–2.0, 0.1 steps); the
                content script owns the value and broadcasts it back. */}
            <div className="mt-2 flex items-center gap-2">
              <span className="w-9 shrink-0 text-right text-[11px] font-medium text-zinc-700">
                {rate.toFixed(1)}x
              </span>
              <input
                type="range"
                min={MIN_RATE}
                max={MAX_RATE}
                step={RATE_STEP}
                value={rate}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setRate(v);
                  void sendToTab({
                    type: 'subtitlesSetRate',
                    videoId: video.info.videoId,
                    rate: v,
                  }).catch(() => undefined);
                }}
                className="min-w-0 flex-1 accent-indigo-600"
                aria-label="播放倍速"
              />
            </div>
          </>
        ) : (
          <div className="text-zinc-500">
            {connectionLost
              ? '当前页面没有字幕控制器（仅支持 YouTube / Bilibili 视频页），可刷新页面重试'
              : '在 YouTube / Bilibili 视频页打开此面板'}
          </div>
        )}
      </div>

      {/* directory / file problems */}
      {video && (loadError || dirState === 'none' || dirState === 'prompt') && (
        <div className="border-b border-zinc-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          {(dirState === 'none' || loadError === 'NO_DIR') && (
            <div>
              <div>尚未选择词库目录，字幕放在词库目录的 _lib/subtitles/ 下</div>
              <button
                type="button"
                onClick={() => void pick()}
                className="mt-1.5 rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-indigo-500"
              >
                选择词库文件夹
              </button>
            </div>
          )}
          {(dirState === 'prompt' || loadError === 'NO_PERMISSION') && (
            <div>
              <div>词库目录需要重新授权（点击面板任意位置即可恢复）</div>
              <button
                type="button"
                onClick={() => void regrant()}
                className="mt-1.5 rounded-lg bg-amber-500 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-amber-400"
              >
                重新授权
              </button>
            </div>
          )}
          {loadError === 'NOT_FOUND' && (
            <div>
              没有找到字幕文件，请按此结构放置，并在 map.json 里登记映射：
              <div className="mt-1 rounded bg-white/70 px-2 py-1 font-mono text-[10px] leading-relaxed">
                _lib/subtitles/{platform}/&lt;上传者&gt;/&lt;标题&gt;.srt
                <br />
                _lib/subtitles/{platform}/map.json
              </div>
              <div className="mt-1 rounded bg-white/70 px-2 py-1 font-mono text-[10px] leading-relaxed">
                {'{ "'}
                <span className="font-semibold">{videoId}</span>
                {'": "<上传者>/<标题>.srt" }'}
                <br />
                {'{ "'}
                <span className="font-semibold">{videoId}</span>
                {'": "<上传者>/map.json" } ← 引用频道级映射'}
              </div>
            </div>
          )}
          {loadError === 'EMPTY' && <div>字幕文件内容为空或无法解析</div>}
          {loadError && !['NO_DIR', 'NO_PERMISSION', 'NOT_FOUND', 'EMPTY'].includes(loadError) && (
            <div>加载字幕失败：{loadError}</div>
          )}
        </div>
      )}

      {/* loop status */}
      {(loop || pendingAIdx != null) && (
        <div className="flex items-center gap-2 border-b border-zinc-200 bg-violet-50 px-3 py-1.5 text-[11px] text-violet-800">
          {loop ? (
            <>
              <span>
                {loop.kind === 'single'
                  ? `🔁 单句循环：第 ${loop.aIdx + 1} 句（a/d 换句，s s 退出）`
                  : `🔁 AB 循环：第 ${loop.aIdx + 1} – ${loop.lastIdx + 1} 句（s s 退出）`}
              </span>
              <button
                type="button"
                onClick={() => runCommand('cancelLoop')}
                className="ml-auto rounded px-1.5 py-0.5 text-[10px] text-violet-600 hover:bg-violet-100"
              >
                取消 (Esc)
              </button>
            </>
          ) : (
            <span>
              A 点已定：第 {(pendingAIdx ?? 0) + 1} 句开头 — 走到结束句按 x（同一句按 x = 单句循环）
            </span>
          )}
        </div>
      )}

      {/* hotkey legend */}
      <div className="border-b border-zinc-200 px-3 py-1.5 text-[10px] leading-relaxed text-zinc-400">
        a 上一句 · d 下一句 · space 播放/暂停 · s 单句循环 · z 定A点 · x 定B点 · j/l 倍速±0.1 · k
        恢复1x · Esc 取消
      </div>

      {/* subtitle list */}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
        {cues.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-zinc-400">
            {loading ? '加载字幕…' : video && !loadError ? '字幕未加载' : ''}
          </div>
        ) : (
          cues.map((cue, idx) => (
            <button
              key={`${cue.start}-${idx}`}
              type="button"
              data-idx={idx}
              onClick={(e) => {
                // A drag-select inside the row also fires click — only seek
                // on a plain click (collapsed selection).
                const selection = window.getSelection();
                if (selection && !selection.isCollapsed) return;
                seekTo(cue.start);
                // Center even when this row is already current (the
                // currentIdx effect won't re-fire for it).
                centerCurrentRow(idx);
                // Drop focus so Space can never re-activate this row.
                e.currentTarget.blur();
              }}
              className={`flex w-full items-start gap-2 border-l-2 px-2 py-1.5 text-left transition-colors ${
                idx === currentIdx
                  ? 'border-l-indigo-500 bg-indigo-50 font-medium text-indigo-900'
                  : inLoopRange(idx)
                    ? 'border-l-violet-300 bg-violet-50/60 text-zinc-800'
                    : 'border-l-transparent text-zinc-700 hover:bg-zinc-50'
              }`}
            >
              <span className="w-7 shrink-0 pt-px text-right font-mono text-[10px] text-zinc-400">
                {idx + 1}
              </span>
              <span className="w-10 shrink-0 pt-px font-mono text-[10px] text-zinc-400">
                {formatSubtitleTime(cue.start)}
              </span>
              <span className="min-w-0 flex-1 whitespace-pre-line leading-snug">{cue.text}</span>
              <span className="flex shrink-0 gap-0.5 pt-px">
                {loop?.aIdx === idx && (
                  <span className="rounded bg-violet-600 px-1 text-[9px] font-semibold text-white">
                    A
                  </span>
                )}
                {loop?.bIdx === idx && loop.kind === 'range' && (
                  <span className="rounded bg-amber-500 px-1 text-[9px] font-semibold text-white">
                    B
                  </span>
                )}
              </span>
            </button>
          ))
        )}
      </div>

      {/* loaded file footer */}
      {subtitlePath && (
        <div className="border-t border-zinc-200 px-3 py-1 text-[10px] text-zinc-400">
          <div className="truncate" title={subtitlePath}>
            📄 {subtitlePath}
          </div>
          <div>{cues.length} 句 · 点击任意句跳转播放</div>
        </div>
      )}
    </div>
  );
}
