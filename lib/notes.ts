// Video notes as markdown files in the vocabulary-bucket repo. A note
// mirrors its subtitle's path: the note for
// _lib/subtitles/<platform>/<uploader>/<title>.srt is
// note/<platform>/<uploader>/<title>.md — same relative path below the
// bucket root's note/ directory, .md extension. Deriving from the subtitle
// path (via map.json) means a note exists for every mapped video, even
// before the first save or without the srt file present.

// The .ts extension keeps this module importable by plain `node` (type
// stripping) for testing the pure helpers; tsconfig allows it.
import { readTextBelow, type VideoPlatform } from './subtitles.ts';

const NOTE_BASE = 'note';

// note/<platform>/<uploader>/<title>.md for a subtitle path relative to the
// bucket root; null when the path is not a recognised subtitle location.
export function notePathForSubtitlePath(subtitlePath: string): string | null {
  for (const prefix of ['_lib/subtitles/', 'user/subtitles/', 'subtitles/']) {
    if (!subtitlePath.startsWith(prefix)) continue;
    const rel = subtitlePath.slice(prefix.length).replace(/\.(srt|vtt)$/i, '.md');
    return rel ? `${NOTE_BASE}/${rel}` : null;
  }
  return null;
}

// Note content; null when the note does not exist yet.
export async function readNoteFile(
  bucketDir: FileSystemDirectoryHandle,
  notePath: string,
): Promise<string | null> {
  return readTextBelow(bucketDir, notePath);
}

// YAML front matter is handled opaquely: notes written by external tooling
// start with a --- block (title/video-link/cover/published...) and the
// WYSIWYG editor must never parse, render or re-serialize it — it is kept as
// raw text and re-joined on save, byte-for-byte.

// Split a note file into its raw front matter (without the --- fences, null
// when the file has none) and the body. Only a leading block counts, and the
// first closing fence wins.
export function splitNoteFrontMatter(raw: string): { front: string | null; body: string } {
  const m = raw.match(/^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { front: null, body: raw };
  return { front: m[1] ?? '', body: raw.slice(m[0].length) };
}

// Inverse of splitNoteFrontMatter — round-trips the original file text.
export function joinNoteFile(front: string | null, body: string): string {
  if (front == null) return body;
  return `---\n${front}\n---\n${body}`;
}

// Create every missing directory below the bucket root and write the note.
export async function writeNoteFile(
  bucketDir: FileSystemDirectoryHandle,
  notePath: string,
  content: string,
): Promise<void> {
  const segments = notePath.split('/').filter(Boolean);
  const fileName = segments.pop();
  if (!fileName) throw new Error(`笔记路径无效: ${notePath}`);
  let cursor: FileSystemDirectoryHandle = bucketDir;
  for (const segment of segments) {
    cursor = await cursor.getDirectoryHandle(segment, { create: true });
  }
  const file = await cursor.getFileHandle(fileName, { create: true });
  const writable = await file.createWritable();
  await writable.write(content);
  await writable.close();
}

// Parse "mm:ss" / "h:mm:ss" into seconds; null when malformed.
export function parseTimestampSeconds(text: string): number | null {
  const m = text.trim().match(/^(\d{1,2}):([0-5]?\d)(?::([0-5]?\d))?$/);
  if (!m) return null;
  if (m[3] == null) {
    return parseInt(m[1] ?? '0', 10) * 60 + parseInt(m[2] ?? '0', 10);
  }
  return parseInt(m[1] ?? '0', 10) * 3600 + parseInt(m[2] ?? '0', 10) * 60 + parseInt(m[3], 10);
}

// Timestamps are stored as the platform's own shareable seek URL, so notes
// stay usable outside the extension too:
//   youtube   https://youtu.be/<id>?t=<seconds>
//   bilibili  https://www.bilibili.com/video/<id>?t=<seconds>
export function timestampUrl(platform: VideoPlatform, videoId: string, seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  return platform === 'youtube'
    ? `https://youtu.be/${videoId}?t=${t}`
    : `https://www.bilibili.com/video/${videoId}?t=${t}`;
}

// Accepts YouTube's plain-seconds and 1h2m3s spellings for t/start.
function parseTimeParam(raw: string): number | null {
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  const m = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m) return null;
  const seconds =
    parseInt(m[1] ?? '0', 10) * 3600 + parseInt(m[2] ?? '0', 10) * 60 + parseInt(m[3] ?? '0', 10);
  return seconds > 0 ? seconds : null;
}

// Extract (videoId, seconds) from a platform timestamp URL; null when the
// link is not one (the preview then treats it as a normal external link).
export function parseTimestampLink(href: string): { videoId: string; seconds: number } | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  let videoId: string | null = null;
  let raw: string | null = null;
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'youtu.be' || host.endsWith('youtube.com')) {
    videoId =
      host === 'youtu.be'
        ? (url.pathname.split('/')[1] ?? null)
        : (url.searchParams.get('v') ??
          url.pathname.match(/\/(?:shorts|live)\/([\w-]{11})/)?.[1] ??
          null);
    raw = url.searchParams.get('t') ?? url.searchParams.get('start');
  } else if (host.endsWith('bilibili.com')) {
    videoId = url.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/)?.[1] ?? null;
    raw = url.searchParams.get('t');
  }
  if (!videoId || raw == null) return null;
  const seconds = parseTimeParam(raw);
  return seconds == null ? null : { videoId, seconds };
}

// A bare timestamp in the note ([mm:ss]) is linkified to the canonical URL
// form so the markdown preview can make it a click-to-seek link.
const BARE_TIMESTAMP_RE = /\[(\d{1,2}:[0-5]?\d(?::[0-5]?\d)?)\](?!\()/g;

// Make manually typed [mm:ss] timestamps clickable too: bare occurrences
// become the canonical link form (existing [..](..) links are left alone).
export function linkNoteTimestamps(markdown: string, hrefFor: (seconds: number) => string): string {
  return markdown.replace(BARE_TIMESTAMP_RE, (raw, text: string) => {
    const seconds = parseTimestampSeconds(text);
    return seconds == null ? raw : `[${text}](${hrefFor(seconds)})`;
  });
}

// Milkdown serializes bullet lists with '*' (prosemirror-markdown's default,
// not configurable); the house style is '-'. Only a leading list marker is
// rewritten — `**bold**`, `\*` escapes and `1.` items never match, and the
// leading indentation is preserved. Meant for Milkdown's serializer output,
// which never emits `* * *` thematic breaks.
export function normalizeListBullets(markdown: string): string {
  return markdown.replace(/^([ \t]*)\*[ \t]/gm, '$1- ');
}
