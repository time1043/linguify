// Local subtitle files provided by the user, not fetched from the video
// sites. Inside the vocabulary-bucket repo the layout stays human-organized
// (uploader / title.srt — no ids in names), and a per-platform map.json ties
// videos to files:
//
//   user/subtitles/youtube/EnglishWithEvie/I'm moving to Canada.srt
//   user/subtitles/youtube/map.json
//     { "C4Acd_5itrA": "EnglishWithEvie/I'm moving to Canada.srt" }
//
// Lookup only needs (platform, videoId): map.json gives the srt path
// relative to the platform directory. As a fallback, files literally named
// <videoId>.srt under the platform directory are found by scanning.

import type { IterableDirectoryHandle } from './fsa';

export type VideoPlatform = 'youtube' | 'bilibili';

// One subtitle line, times in seconds. This is the wire format sent from the
// side panel to the content script, so it stays plain-JSON friendly.
export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

// Resolved identifiers of the video the content script is currently on.
export interface SubtitlesVideoInfo {
  platform: VideoPlatform;
  videoId: string;
  title: string;
}

// Loop playback window owned by the content script. The loop plays from the
// start of line aIdx through the end of line bIdx (both lines included);
// for a single-line loop aIdx == bIdx == lastIdx and the window is that
// line's [start, end].
export interface SubtitlesLoopState {
  kind: 'single' | 'range';
  start: number;
  end: number;
  aIdx: number;
  bIdx: number;
  lastIdx: number;
}

export type SubtitleCommand =
  | 'prev'
  | 'next'
  | 'togglePlay'
  | 'toggleSingle'
  | 'markA'
  | 'markB'
  | 'cancelLoop';

// --- side panel -> content script (via tabs.sendMessage) ---
export interface SubtitlesSetCuesMessage {
  type: 'subtitlesSetCues';
  videoId: string;
  cues: SubtitleCue[];
}
export interface SubtitlesSeekMessage {
  type: 'subtitlesSeek';
  videoId: string;
  time: number;
}
export interface SubtitlesCommandMessage {
  type: 'subtitlesCommand';
  videoId: string;
  cmd: SubtitleCommand;
}
export interface SubtitlesRequestInfoMessage {
  type: 'subtitlesRequestInfo';
}

// --- content script -> side panel (broadcast via runtime.sendMessage) ---
export interface SubtitlesVideoMessage {
  type: 'subtitlesVideo';
  video: SubtitlesVideoInfo | null;
}
export interface SubtitlesStateMessage {
  type: 'subtitlesState';
  videoId: string;
  currentIdx: number;
  playing: boolean;
  pendingAIdx: number | null;
  loop: SubtitlesLoopState | null;
  cueCount: number;
}

// Same platform detection as the (fetch-based) subtitles feature used before,
// so file lookup and hotkeys work on both sites.
export function detectPlatform(url: string): { platform: VideoPlatform; videoId: string } | null {
  const yt = url.match(
    /(?:youtube\.com\/(?:watch\?[^#]*v=|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/,
  );
  if (yt?.[1]) return { platform: 'youtube', videoId: yt[1] };
  const bili = url.match(/bilibili\.com\/video\/(BV[0-9A-Za-z]+)/);
  if (bili?.[1]) return { platform: 'bilibili', videoId: bili[1] };
  return null;
}

// Accepts SRT ("00:00:01,000") and WebVTT ("00:00:01.000") timestamps; the
// hours part is optional for VTT ("01:02.000").
function parseTimestamp(raw: string): number | null {
  const m = raw.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/);
  if (!m) return null;
  const hours = m[1] ? parseInt(m[1], 10) : 0;
  const seconds = hours * 3600 + parseInt(m[2] ?? '0', 10) * 60 + parseInt(m[3] ?? '0', 10);
  return seconds + parseInt((m[4] ?? '0').padEnd(3, '0'), 10) / 1000;
}

function decodeSubtitleEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// Parse SRT (and tolerate WebVTT) subtitle text into sorted cues. Multi-line
// cue bodies keep their line breaks; inline markup like <i>/<c> is stripped.
export function parseSubtitleText(raw: string): SubtitleCue[] {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const cues: SubtitleCue[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n').filter((line) => line.trim() !== '');
    if (lines.length === 0) continue;
    // WebVTT headers and NOTE/STYLE blocks have no timing line and are
    // dropped naturally by the '-->' check below, except when they carry
    // "-->" in prose — the prefix check handles that.
    if (/^(WEBVTT|NOTE|STYLE)/.test(lines[0]?.trim() ?? '')) continue;
    const timingIdx = lines.findIndex((line) => line.includes('-->'));
    if (timingIdx === -1) continue;
    const [from, to] = lines[timingIdx]?.split('-->') ?? [];
    const start = parseTimestamp(from ?? '');
    // VTT timing lines can carry cue settings after the end timestamp.
    const end = parseTimestamp((to ?? '').trim().split(/\s+/)[0] ?? '');
    if (start == null || end == null || end <= start) continue;
    const body = decodeSubtitleEntities(
      lines
        .slice(timingIdx + 1)
        .join('\n')
        .replace(/<[^>]+>/g, ''),
    ).trim();
    if (!body) continue;
    cues.push({ start, end, text: body });
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}

// Index of the last cue that has started at time t (-1 when none yet).
export function findCueIndexAtTime(cues: SubtitleCue[], t: number): number {
  let lo = 0;
  let hi = cues.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((cues[mid]?.start ?? Infinity) <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

export interface LocalSubtitleFile {
  // Path relative to the chosen bucket root, for display only.
  path: string;
  text: string;
}

const SUBTITLE_FILE_RE = /\.(srt|vtt)$/i;

// Normalize a map.json value into a path relative to the platform directory.
// Written by hand, so it is liberally interpreted: backslashes become
// slashes, and leading "/", "./", "user/subtitles/" and "<platform>/"
// prefixes are all stripped.
export function normalizeMappedPath(raw: string, platform: VideoPlatform): string {
  let rel = raw
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '');
  if (rel.startsWith('user/subtitles/')) rel = rel.slice('user/subtitles/'.length);
  if (rel.startsWith(`${platform}/`)) rel = rel.slice(platform.length + 1);
  return rel;
}

// Candidates tried in order for a mapped path; a map entry may omit the
// extension entirely.
export function subtitlePathCandidates(rel: string): string[] {
  if (SUBTITLE_FILE_RE.test(rel)) return [rel];
  return [rel, `${rel}.srt`, `${rel}.vtt`];
}

// Read user/subtitles/<platform>/map.json ({ videoId: srt path }) and return
// the mapped path for the video, or null when the map is missing, unreadable
// or has no entry (the filename scan takes over then).
async function resolveMappedSubtitle(
  platformDir: FileSystemDirectoryHandle,
  platform: VideoPlatform,
  videoId: string,
): Promise<string | null> {
  let map: unknown;
  try {
    const file = await platformDir.getFileHandle('map.json');
    map = JSON.parse(await (await file.getFile()).text());
  } catch {
    return null;
  }
  if (!map || typeof map !== 'object') return null;
  let value = (map as Record<string, unknown>)[videoId];
  // Tolerate a list of paths (e.g. languages) by taking the first string.
  if (Array.isArray(value)) value = value.find((item) => typeof item === 'string');
  if (typeof value !== 'string' || !value.trim()) return null;
  return normalizeMappedPath(value, platform);
}

// Read a file at a slash-separated path below dir (getFileHandle only takes
// single segments, so traverse segment by segment).
async function readTextBelow(
  dir: FileSystemDirectoryHandle,
  relPath: string,
): Promise<string | null> {
  for (const candidate of subtitlePathCandidates(relPath)) {
    const segments = candidate.split('/').filter(Boolean);
    const fileName = segments.pop();
    if (!fileName) continue;
    let cursor: FileSystemDirectoryHandle | null = dir;
    for (const segment of segments) {
      cursor = cursor ? await cursor.getDirectoryHandle(segment).catch(() => null) : null;
    }
    if (!cursor) continue;
    try {
      const handle = await cursor.getFileHandle(fileName);
      return await (await handle.getFile()).text();
    } catch {
      // Try the next candidate (extension appended, etc.).
    }
  }
  return null;
}

// Find the subtitle for a video inside the vocabulary-bucket root the
// extension already has a handle for; also accepts a bare subtitles/
// directory at the root. Preferred source is <platform>/map.json; failing
// that, files named <videoId>.srt anywhere up to uploader/title depth are
// found by scanning.
export async function findLocalSubtitleFile(
  bucketDir: FileSystemDirectoryHandle,
  platform: VideoPlatform,
  videoId: string,
): Promise<LocalSubtitleFile | null> {
  for (const base of ['user/subtitles', 'subtitles']) {
    let dir: FileSystemDirectoryHandle | null = bucketDir;
    for (const part of base.split('/')) {
      dir = dir ? await dir.getDirectoryHandle(part).catch(() => null) : null;
    }
    if (!dir) continue;
    const platformDir = await dir.getDirectoryHandle(platform).catch(() => null);
    if (!platformDir) continue;
    const mapped = await resolveMappedSubtitle(platformDir, platform, videoId);
    if (mapped) {
      const text = await readTextBelow(platformDir, mapped);
      if (text != null) return { path: `${base}/${platform}/${mapped}`, text };
    }
    const hit = await scanForSubtitleFile(platformDir, videoId, `${base}/${platform}`, 2);
    if (hit) return hit;
  }
  return null;
}

async function scanForSubtitleFile(
  dir: FileSystemDirectoryHandle,
  videoId: string,
  prefix: string,
  depth: number,
): Promise<LocalSubtitleFile | null> {
  for await (const entry of (dir as IterableDirectoryHandle).values()) {
    if (entry.kind === 'file') {
      if (!SUBTITLE_FILE_RE.test(entry.name)) continue;
      if (entry.name.replace(SUBTITLE_FILE_RE, '') !== videoId) continue;
      const text = await (await (entry as FileSystemFileHandle).getFile()).text();
      return { path: `${prefix}/${entry.name}`, text };
    } else if (depth > 0) {
      const hit = await scanForSubtitleFile(
        entry as FileSystemDirectoryHandle,
        videoId,
        `${prefix}/${entry.name}`,
        depth - 1,
      );
      if (hit) return hit;
    }
  }
  return null;
}

export function formatSubtitleTime(t: number): string {
  const hours = Math.floor(t / 3600);
  const minutes = Math.floor((t % 3600) / 60);
  const seconds = Math.floor(t % 60);
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
