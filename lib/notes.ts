// Video notes as markdown files in the vocabulary-bucket repo. A note
// mirrors its subtitle's path: the note for
// _lib/subtitles/<platform>/<uploader>/<title>.srt is
// note/<platform>/<uploader>/<title>.md — same relative path below the
// bucket root's note/ directory, .md extension. Deriving from the subtitle
// path (via map.json) means a note exists for every mapped video, even
// before the first save or without the srt file present.

// The .ts extension keeps this module importable by plain `node` (type
// stripping) for testing the pure helpers; tsconfig allows it.
import { readTextBelow } from './subtitles.ts';

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

// A timestamp in the note is rendered as [mm:ss](#ts=<seconds>) so the
// markdown preview can make it a click-to-seek link.
const BARE_TIMESTAMP_RE = /\[(\d{1,2}:[0-5]?\d(?::[0-5]?\d)?)\](?!\()/g;

// Make manually typed [mm:ss] timestamps clickable too: bare occurrences
// become the canonical link form (existing [..](..) links are left alone).
export function linkNoteTimestamps(markdown: string): string {
  return markdown.replace(BARE_TIMESTAMP_RE, (raw, text: string) => {
    const seconds = parseTimestampSeconds(text);
    return seconds == null ? raw : `[${text}](#ts=${seconds})`;
  });
}
