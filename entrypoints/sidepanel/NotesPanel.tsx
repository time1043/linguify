// 记笔记 tab. A note is a markdown file in the vocabulary-bucket repo that
// mirrors the video's subtitle path: note/<platform>/<uploader>/<title>.md
// (see lib/notes.ts). Files written by external tooling may carry YAML front
// matter — it is split off on load, shown in a collapsible raw-text block
// and re-joined verbatim on save; the editors (Milkdown WYSIWYG, textarea
// 源码, react-markdown 预览) only ever see the body. Saves are debounced and
// also flushed when the video or tab changes. Timestamps —
// [mm:ss](https://youtu.be/…?t=n) — are inserted from the video's current
// playhead: a single click on one seeks the video in place (in the editor
// the mousedown is intercepted so the link tooltip never opens). Manually
// typed [mm:ss] works too, see linkNoteTimestamps.

import { Crepe } from '@milkdown/crepe';
// Selective theme imports: the aggregated common/style.css would pull the
// LaTeX (KaTeX, ~3.4MB of fonts) and CodeMirror styles for features the
// notes editor disables below.
import '@milkdown/crepe/theme/classic.css';
import '@milkdown/crepe/theme/common/prosemirror.css';
import '@milkdown/crepe/theme/common/reset.css';
import '@milkdown/crepe/theme/common/block-edit.css';
import '@milkdown/crepe/theme/common/cursor.css';
import '@milkdown/crepe/theme/common/image-block.css';
import '@milkdown/crepe/theme/common/link-tooltip.css';
import '@milkdown/crepe/theme/common/list-item.css';
import '@milkdown/crepe/theme/common/placeholder.css';
import '@milkdown/crepe/theme/common/toolbar.css';
import '@milkdown/crepe/theme/common/table.css';
import '@milkdown/crepe/theme/common/top-bar.css';
import { insert, replaceAll } from '@milkdown/kit/utils';
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { getBucketDir } from '@/lib/fsa';
import {
  joinNoteFile,
  linkNoteTimestamps,
  normalizeListBullets,
  notePathForSubtitlePath,
  parseTimestampLink,
  readNoteFile,
  splitNoteFrontMatter,
  timestampUrl,
  writeNoteFile,
} from '@/lib/notes';
import {
  formatSubtitleTime,
  resolveLocalSubtitlePath,
  type SubtitlesTimeResponse,
} from '@/lib/subtitles';

import { useActiveVideo } from './use-active-video';
import { useBucketDir } from './use-bucket-dir';

type EditorMode = 'wysiwyg' | 'source' | 'preview';
type SaveState = 'idle' | 'dirty' | 'saving' | 'saved';

const AUTOSAVE_DELAY_MS = 800;

export default function NotesPanel({ active }: { active: boolean }) {
  const { video, connectionLost, sendToTab } = useActiveVideo();
  const { dirState, pick, regrant, tick } = useBucketDir();

  const [notePath, setNotePath] = useState<string | null>(null);
  const [noMapping, setNoMapping] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // `content` is the note BODY — the YAML front matter lives separately and
  // is never fed to the editors (see lib/notes.ts).
  const [content, setContent] = useState('');
  const [frontMatter, setFrontMatter] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [mode, setMode] = useState<EditorMode>('wysiwyg');

  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const milkdownHostRef = useRef<HTMLDivElement | null>(null);
  const crepeRef = useRef<Crepe | null>(null);
  // The markdown the Milkdown doc currently holds — the marker for deciding
  // whether source-mode edits need to be pushed into the editor.
  const editorMdRef = useRef('');
  const contentRef = useRef('');
  const savedContentRef = useRef('');
  const frontRef = useRef<string | null>(null);
  const savedFrontRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const notePathRef = useRef<string | null>(null);
  notePathRef.current = notePath;

  const videoId = video?.info.videoId;
  const platform = video?.info.platform;

  const markDirty = useCallback((): void => {
    const dirty =
      contentRef.current !== savedContentRef.current || frontRef.current !== savedFrontRef.current;
    dirtyRef.current = dirty;
    setSaveState(dirty ? 'dirty' : 'idle');
  }, []);

  const flush = useCallback(async (): Promise<void> => {
    if (!dirtyRef.current) return;
    const path = notePathRef.current;
    if (!path) return;
    const dir = await getBucketDir();
    if (!dir) return;
    setSaveState('saving');
    try {
      await writeNoteFile(dir, path, joinNoteFile(frontRef.current, contentRef.current));
      savedContentRef.current = contentRef.current;
      savedFrontRef.current = frontRef.current;
      dirtyRef.current = false;
      setSaveState('saved');
    } catch (err) {
      setSaveState('dirty');
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Load (or reload) the note whenever the video changes. The cleanup flush
  // pending edits first, so switching videos never loses the previous note.
  // notePath is only set once the content has been read — everything keyed
  // on it (including the editor) then sees the fresh note.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotePath(null);
    setNoMapping(false);
    setLoadError(null);
    setContent('');
    contentRef.current = '';
    savedContentRef.current = '';
    setFrontMatter(null);
    frontRef.current = null;
    savedFrontRef.current = null;
    dirtyRef.current = false;
    setSaveState('idle');
    void (async () => {
      try {
        if (!video || !videoId || !platform) return;
        const dir = await getBucketDir();
        if (!dir) {
          setLoadError('NO_DIR');
          return;
        }
        if ((await dir.queryPermission({ mode: 'read' })) !== 'granted') {
          setLoadError('NO_PERMISSION');
          return;
        }
        const srtPath = await resolveLocalSubtitlePath(dir, platform, videoId);
        const path = srtPath ? notePathForSubtitlePath(srtPath) : null;
        if (!path) {
          if (!cancelled) setNoMapping(true);
          return;
        }
        const raw = await readNoteFile(dir, path);
        if (cancelled) return;
        const { front, body } = splitNoteFrontMatter(raw ?? '');
        setFrontMatter(front);
        frontRef.current = front;
        savedFrontRef.current = front;
        setContent(body);
        contentRef.current = body;
        savedContentRef.current = body;
        dirtyRef.current = false;
        setSaveState('idle');
        setNotePath(path);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      void flush();
    };
  }, [video, videoId, platform, tick, flush]);

  // Debounced autosave while typing.
  useEffect(() => {
    if (!dirtyRef.current) return;
    const timer = setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [content, flush]);

  // The panel stays mounted across tab switches — flush when this tab loses
  // the front so a note is never left unsaved on screen switch.
  useEffect(() => {
    if (active) return;
    void flush();
  }, [active, flush]);

  const onContentChange = useCallback(
    (value: string): void => {
      contentRef.current = value;
      setContent(value);
      markDirty();
    },
    [markDirty],
  );

  // Metadata is stored as opaque raw text; emptying it drops the block.
  const onFrontMatterChange = useCallback(
    (value: string): void => {
      const next = value.trim() ? value : null;
      frontRef.current = next;
      setFrontMatter(next);
      markDirty();
    },
    [markDirty],
  );

  // Milkdown instance lives per note: created when the note is ready,
  // destroyed on the next note. The host div is always mounted so switching
  // 编辑模式 never recreates the editor.
  useEffect(() => {
    if (!notePath || !milkdownHostRef.current) return;
    let disposed = false;
    const host = document.createElement('div');
    milkdownHostRef.current.replaceChildren(host);
    editorMdRef.current = contentRef.current;
    const crepe = new Crepe({
      root: host,
      defaultValue: contentRef.current,
      // Language notes need none of the heavy extras; Latex/CodeMirror/AI
      // stay off so their half-styled UI never appears either.
      features: {
        [Crepe.Feature.Latex]: false,
        [Crepe.Feature.CodeMirror]: false,
        [Crepe.Feature.AI]: false,
        [Crepe.Feature.ImageBlock]: false,
      },
      featureConfigs: {
        [Crepe.Feature.Placeholder]: { text: '记下这个视频的笔记…' },
      },
    });
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        if (disposed) return;
        // Milkdown emits '*' bullets; the house style is '-'.
        const normalized = normalizeListBullets(markdown);
        editorMdRef.current = normalized;
        onContentChange(normalized);
      });
    });
    void crepe
      .create()
      .then(() => {
        if (disposed) void crepe.destroy();
        else crepeRef.current = crepe;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      if (crepeRef.current === crepe) crepeRef.current = null;
      void crepe.destroy().catch(() => undefined);
    };
  }, [notePath, onContentChange]);

  // Edits made in 源码 (or appended while in 预览) must reach the WYSIWYG
  // doc — push them in when that mode becomes visible again. The editor's
  // own emissions update editorMdRef first, so this only fires for external
  // changes and never loops.
  useEffect(() => {
    if (mode !== 'wysiwyg') return;
    const crepe = crepeRef.current;
    if (!crepe || content === editorMdRef.current) return;
    void crepe.editor.action(replaceAll(content));
  }, [mode, content]);

  const seekTo = useCallback(
    (seconds: number): void => {
      if (!video) return;
      void sendToTab({ type: 'subtitlesSeek', videoId: video.info.videoId, time: seconds }).catch(
        () => undefined,
      );
    },
    [video, sendToTab],
  );

  // Timestamp clicks never navigate: a link to the current video seeks it in
  // place; anything else (another video / a plain URL) opens a new tab.
  const openTimestamp = useCallback(
    (href: string): void => {
      if (href.startsWith('#ts=')) {
        const seconds = Number(href.slice(4));
        if (Number.isFinite(seconds)) seekTo(seconds);
        return;
      }
      const parsed = parseTimestampLink(href);
      if (parsed && video && parsed.videoId === video.info.videoId) {
        seekTo(parsed.seconds);
        return;
      }
      void browser.tabs
        .create({ url: href })
        .catch(() => window.open(href, '_blank', 'noreferrer'));
    },
    [video, seekTo],
  );

  // In the WYSIWYG editor a plain click belongs to the editor (link editing
  // tooltip); Ctrl+click hands the timestamp to us.
  useEffect(() => {
    const host = milkdownHostRef.current;
    if (!host) return;
    const onClick = (e: MouseEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const anchor = (e.target as HTMLElement | null)?.closest('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href') ?? '';
      e.preventDefault();
      e.stopPropagation();
      openTimestamp(href);
    };
    host.addEventListener('click', onClick, true);
    return () => host.removeEventListener('click', onClick, true);
    // notePath is a dependency because the host div only exists once a note
    // is loaded — binding at mount (no note yet) would silently no-op.
  }, [openTimestamp, notePath]);

  const insertTimestamp = useCallback(async (): Promise<void> => {
    if (!video || !videoId || !platform) return;
    let time = 0;
    try {
      const res = (await sendToTab({
        type: 'subtitlesGetTime',
        videoId,
      })) as Partial<SubtitlesTimeResponse> | null;
      if (typeof res?.time === 'number') time = res.time;
    } catch {
      // No controller on the page — stamp 00:00 rather than failing.
    }
    const stamp = `[${formatSubtitleTime(time)}](${timestampUrl(platform, videoId, time)})`;
    if (mode === 'wysiwyg') {
      const crepe = crepeRef.current;
      if (crepe) {
        crepe.editor.action(insert(stamp, true));
        return;
      }
    } else if (mode === 'source') {
      const editor = editorRef.current;
      if (editor) {
        const start = editor.selectionStart ?? contentRef.current.length;
        const end = editor.selectionEnd ?? start;
        const next = contentRef.current.slice(0, start) + stamp + contentRef.current.slice(end);
        onContentChange(next);
        requestAnimationFrame(() => {
          editor.focus();
          editor.selectionStart = editor.selectionEnd = start + stamp.length;
        });
        return;
      }
    }
    // Preview mode or no live editor: append on its own line.
    const base = contentRef.current;
    const glue = base && !base.endsWith('\n') ? '\n' : '';
    onContentChange(base + glue + stamp);
  }, [video, videoId, platform, mode, sendToTab, onContentChange]);

  // Bare [mm:ss] stamps become the platform share URL when a video is known;
  // without one they stay locally seekable fragments.
  const markdown = linkNoteTimestamps(
    content,
    video && videoId && platform
      ? (seconds) => timestampUrl(platform, videoId, seconds)
      : (seconds) => `#ts=${seconds}`,
  );

  const preview = (
    <div className="md-body h-full overflow-y-auto px-3 py-2 text-xs leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const target = href ?? '';
            const isStamp = target.startsWith('#ts=') || parseTimestampLink(target) != null;
            if (isStamp) {
              return (
                <button
                  type="button"
                  onClick={() => openTimestamp(target)}
                  title="跳转到视频对应位置"
                  className="md-ts-link"
                >
                  {children}
                </button>
              );
            }
            return (
              <a href={target} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );

  const sourceEditor = (
    <textarea
      ref={editorRef}
      value={content}
      onChange={(e) => onContentChange(e.target.value)}
      spellCheck={false}
      placeholder={
        '记下这个视频的笔记…\n\n[03:25](https://youtu.be/…?t=205) 或点「插入时间戳」\n# 标题\n- 要点'
      }
      className="h-full w-full resize-none bg-white px-3 py-2 font-mono text-xs leading-relaxed text-zinc-800 outline-none"
    />
  );

  const saveBadge: Record<SaveState, string> = {
    idle: '',
    dirty: '未保存…',
    saving: '保存中…',
    saved: '已保存',
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white text-xs text-zinc-800">
      {/* current video */}
      <div className="border-b border-zinc-200 px-3 py-2">
        {video ? (
          <div className="flex items-center gap-2">
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-white">
              {video.info.platform}
            </span>
            <span
              className="min-w-0 flex-1 truncate text-[11px] text-zinc-600"
              title={video.info.title}
            >
              {video.info.title}
            </span>
          </div>
        ) : (
          <div className="text-zinc-500">
            {connectionLost
              ? '当前页面没有字幕控制器（仅支持 YouTube / Bilibili 视频页），可刷新页面重试'
              : '在 YouTube / Bilibili 视频页打开此面板'}
          </div>
        )}
      </div>

      {/* directory / permission problems */}
      {(dirState === 'none' || dirState === 'prompt') && (
        <div className="border-b border-zinc-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          {dirState === 'none' ? (
            <div>
              <div>尚未选择数据目录，笔记保存在其 note/ 下</div>
              <button
                type="button"
                onClick={() => void pick()}
                className="mt-1.5 rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-indigo-500"
              >
                选择数据文件夹
              </button>
            </div>
          ) : (
            <div>
              <div>数据目录需要重新授权</div>
              <button
                type="button"
                onClick={() => void regrant()}
                className="mt-1.5 rounded-lg bg-amber-500 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-amber-400"
              >
                重新授权
              </button>
            </div>
          )}
        </div>
      )}

      {/* note-not-possible states */}
      {video &&
        !notePath &&
        (noMapping || (loadError && !['NO_DIR', 'NO_PERMISSION'].includes(loadError))) && (
          <div className="border-b border-zinc-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            {noMapping && (
              <div>
                该视频没有登记字幕映射，无法确定笔记路径。请在数据仓库的 _lib/subtitles/{platform}
                /map.json 里加入它的 videoId。
              </div>
            )}
            {loadError && !['NO_DIR', 'NO_PERMISSION'].includes(loadError) && (
              <div>加载笔记失败：{loadError}</div>
            )}
          </div>
        )}

      {/* note path + toolbar */}
      {notePath && (
        <>
          <div className="border-b border-zinc-200 px-3 py-1 text-[10px] text-zinc-400">
            <div className="truncate font-mono" title={notePath}>
              📝 {notePath}
            </div>
          </div>
          {/* YAML front matter — opaque raw text, kept out of the editors and
              re-joined verbatim on save */}
          {frontMatter != null && (
            <details className="border-b border-zinc-200 px-3 py-1 text-[10px] text-zinc-500">
              <summary className="cursor-pointer select-none py-0.5">元数据 (front matter)</summary>
              <textarea
                value={frontMatter}
                onChange={(e) => onFrontMatterChange(e.target.value)}
                spellCheck={false}
                rows={Math.min(10, frontMatter.split('\n').length + 1)}
                className="mt-1 w-full resize-y rounded border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-[10px] leading-relaxed text-zinc-700 outline-none focus:border-indigo-300"
              />
            </details>
          )}
          <div className="flex items-center gap-1.5 border-b border-zinc-200 px-2 py-1.5">
            <button
              type="button"
              onClick={() => void insertTimestamp()}
              disabled={!video}
              className="rounded-lg bg-violet-600 px-2 py-1 text-[10px] font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
              title="把视频当前播放位置作为时间戳写进笔记"
            >
              ⏱ 插入时间戳
            </button>
            <div className="ml-auto flex overflow-hidden rounded-lg border border-zinc-200 text-[10px]">
              {(
                [
                  ['wysiwyg', '一体化'],
                  ['source', '源码'],
                  ['preview', '预览'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMode(id)}
                  className={`px-2 py-1 transition-colors ${
                    mode === id ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:bg-zinc-100'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void flush()}
              disabled={!dirtyRef.current}
              className="rounded-lg border border-zinc-200 px-2 py-1 text-[10px] text-zinc-600 hover:bg-zinc-100 disabled:opacity-40"
            >
              保存
            </button>
            <span
              className={`w-12 text-right text-[10px] ${
                saveState === 'dirty' ? 'text-amber-600' : 'text-zinc-400'
              }`}
            >
              {saveBadge[saveState]}
            </span>
          </div>

          {/* editor / preview — the Milkdown host is always mounted (hidden
              in other modes) so the editor instance survives mode switches */}
          <div className="flex min-h-0 flex-1 flex-col">
            <div
              ref={milkdownHostRef}
              className={mode === 'wysiwyg' ? 'min-h-0 flex-1 overflow-y-auto' : 'hidden'}
            />
            {mode === 'source' && <div className="min-h-0 flex-1">{sourceEditor}</div>}
            {mode === 'preview' && <div className="min-h-0 flex-1">{preview}</div>}
          </div>
          <div className="border-t border-zinc-200 px-3 py-1 text-[10px] text-zinc-400">
            时间戳如 [03:25](https://youtu.be/…?t=205)；编辑器内 Ctrl+点击 跳转，预览里单击跳转
          </div>
        </>
      )}

      {/* no note target / loading */}
      {!notePath && (
        <div className="px-3 py-6 text-center text-[11px] text-zinc-400">
          {loading
            ? '加载笔记…'
            : video && !noMapping && !loadError
              ? '在 YouTube / Bilibili 视频页打开此面板'
              : ''}
        </div>
      )}
    </div>
  );
}
