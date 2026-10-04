// 字幕 tab. Subtitles come from files the user downloaded themselves, laid
// out inside the vocabulary-bucket repo as
// user/subtitles/<platform>/<uploader>/<title>/<videoId>.srt — this panel
// resolves that file for the active tab's video and keeps the list in sync
// with the page's <video> element (see entrypoints/subtitles.content.ts,
// which owns playback and the hotkeys).

import { useCallback, useEffect, useRef, useState } from 'react';

import { getBucketDir, pickBucketDir, requestBucketPermission } from '@/lib/fsa';
import {
  findLocalSubtitleFile,
  formatSubtitleTime,
  parseSubtitleText,
  type SubtitleCue,
  type SubtitleCommand,
  type SubtitlesLoopState,
  type SubtitlesVideoInfo,
} from '@/lib/subtitles';

type Sender = { tab?: { id?: number } | null };

// Codes the panel itself maps to guidance; anything else is shown verbatim.
type LoadError = 'NO_DIR' | 'NO_PERMISSION' | 'NOT_FOUND' | 'EMPTY' | string;

interface PanelVideo {
  info: SubtitlesVideoInfo;
  tabId: number;
}

export default function SubtitlesPanel() {
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [video, setVideo] = useState<PanelVideo | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [subtitlePath, setSubtitlePath] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [loading, setLoading] = useState(false);
  // Directory state is re-read after picking / regranting (dirTick bumps it).
  const [dirState, setDirState] = useState<'none' | 'prompt' | 'ok' | null>(null);
  const [dirTick, setDirTick] = useState(0);
  const [currentIdx, setCurrentIdx] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [pendingAIdx, setPendingAIdx] = useState<number | null>(null);
  const [loop, setLoop] = useState<SubtitlesLoopState | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const activeTabIdRef = useRef<number | null>(null);
  activeTabIdRef.current = activeTabId;

  // Track the active tab — the panel always mirrors whichever tab is in front.
  useEffect(() => {
    const query = (): void => {
      void browser.tabs
        .query({ active: true, currentWindow: true })
        .then(([tab]) => setActiveTabId(tab?.id ?? null))
        .catch(() => setActiveTabId(null));
    };
    query();
    const onActivated = (): void => query();
    browser.tabs.onActivated.addListener(onActivated);
    return () => browser.tabs.onActivated.removeListener(onActivated);
  }, []);

  useEffect(() => {
    void (async () => {
      const dir = await getBucketDir().catch(() => null);
      if (!dir) {
        setDirState('none');
        return;
      }
      setDirState((await dir.queryPermission({ mode: 'read' })) === 'granted' ? 'ok' : 'prompt');
    })();
  }, [dirTick]);

  // Switching tabs resets everything; the content script on the new tab is
  // asked to (re)announce itself. No answer means it is not a video page.
  useEffect(() => {
    setVideo(null);
    setConnectionLost(false);
    setCues([]);
    setSubtitlePath(null);
    setLoadError(null);
    setCurrentIdx(-1);
    setLoop(null);
    setPendingAIdx(null);
    setPlaying(false);
    if (activeTabId == null) return;
    void browser.tabs
      .sendMessage(activeTabId, { type: 'subtitlesRequestInfo' })
      .catch(() => setConnectionLost(true));
  }, [activeTabId]);

  // Broadcasts from the content scripts, filtered to the active tab.
  useEffect(() => {
    const onMessage = (message: unknown, sender: Sender): undefined => {
      const tabId = sender.tab?.id;
      if (tabId == null || tabId !== activeTabIdRef.current) return;
      const msg = message as
        | {
            type?: string;
            video?: SubtitlesVideoInfo | null;
            videoId?: string;
            currentIdx?: number;
            playing?: boolean;
            pendingAIdx?: number | null;
            loop?: SubtitlesLoopState | null;
          }
        | undefined;
      if (msg?.type === 'subtitlesVideo') {
        setConnectionLost(false);
        setVideo(msg.video ? { info: msg.video, tabId } : null);
      } else if (msg?.type === 'subtitlesState') {
        setCurrentIdx(msg.currentIdx ?? -1);
        setPlaying(msg.playing ?? false);
        setPendingAIdx(msg.pendingAIdx ?? null);
        setLoop(msg.loop ?? null);
      }
      return undefined;
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }, []);

  const sendToTab = useCallback(async (message: Record<string, unknown>): Promise<void> => {
    const tabId = activeTabIdRef.current;
    if (tabId == null) throw new Error('活动标签页未知');
    await browser.tabs.sendMessage(tabId, message);
  }, []);

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
        if ((await dir.queryPermission({ mode: 'read' })) !== 'granted') {
          if (!cancelled) setLoadError('NO_PERMISSION');
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
  }, [video, videoId, platform, dirTick, sendToTab]);

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
  // in the panel (e.g. right after clicking a line).
  useEffect(() => {
    const keyCommands: Record<string, SubtitleCommand> = {
      a: 'prev',
      d: 'next',
      s: 'toggleSingle',
      z: 'markA',
      x: 'markB',
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)))
        return;
      const cmd = keyCommands[e.key.toLowerCase()];
      if (!cmd) return;
      if (e.repeat && cmd !== 'prev' && cmd !== 'next') return;
      e.preventDefault();
      runCommand(cmd);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [runCommand]);

  // Follow playback: keep the current line visible.
  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-idx="${currentIdx}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [currentIdx, cues]);

  const pick = useCallback(async () => {
    await pickBucketDir();
    setDirState('ok');
    setDirTick((tick) => tick + 1);
  }, []);

  const regrant = useCallback(async () => {
    await requestBucketPermission();
    setDirState('ok');
    setDirTick((tick) => tick + 1);
  }, []);

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
              <div>尚未选择词库目录，字幕放在词库目录的 user/subtitles/ 下</div>
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
              <div>词库目录需要重新授权</div>
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
              没有找到字幕文件，请按此结构放置：
              <div className="mt-1 rounded bg-white/70 px-2 py-1 font-mono text-[10px] leading-relaxed">
                user/subtitles/{platform}/&lt;上传者&gt;/&lt;标题&gt;/
                <span className="font-semibold">{videoId}</span>.srt
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
                  ? `🔁 单句循环：第 ${loop.aIdx + 1} 句`
                  : `🔁 AB 循环：第 ${loop.aIdx + 1} – ${loop.lastIdx + 1} 句`}
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
              A 点已定：第 {(pendingAIdx ?? 0) + 1} 句开头 — 走到结束句的下一句按 x（同一句按 x =
              单句循环）
            </span>
          )}
        </div>
      )}

      {/* hotkey legend */}
      <div className="border-b border-zinc-200 px-3 py-1.5 text-[10px] text-zinc-400">
        a 上一句 · d 下一句 · s 单句循环 · z 定A点 · x 定B点 · Esc 取消
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
              onClick={() => seekTo(cue.start)}
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
