// Subtitle fetching for YouTube and Bilibili video pages. Runs in the
// background service worker (host permissions bypass CORS for the API and
// CDN hosts). Community-standard approach: scrape the player response for
// YouTube caption tracks, use bilibili's public view/player APIs for CC.

export interface SubtitleLine {
  start: number;
  dur: number;
  text: string;
}

export interface SubtitleResult {
  platform: 'youtube' | 'bilibili';
  title: string;
  lang: string;
  lines: SubtitleLine[];
}

export type VideoPlatform = 'youtube' | 'bilibili';

export function detectPlatform(url: string): { platform: VideoPlatform; videoId: string } | null {
  const yt = url.match(/(?:youtube\.com\/(?:watch\?[^#]*v=|shorts\/)|youtu\.be\/)([\w-]{11})/);
  if (yt?.[1]) return { platform: 'youtube', videoId: yt[1] };
  const bili = url.match(/bilibili\.com\/video\/(BV\w+)/);
  if (bili?.[1]) return { platform: 'bilibili', videoId: bili[1] };
  return null;
}

// Extract the JSON objects assigned to a marker in an HTML page
// (ytInitialPlayerResponse / __INITIAL_STATE__). The marker can appear
// several times (player JS references it too), so every assignment is tried
// — the caller picks the object it needs.
export function* extractJsonAfter(html: string, marker: string): Generator<unknown> {
  const assignRe = new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*', 'g');
  for (const match of html.matchAll(assignRe)) {
    const start = html.indexOf('{', match.index + match[0].length);
    if (start === -1) break;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let done = false;
    for (let i = start; i < html.length && !done; i++) {
      const ch = html[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            yield JSON.parse(html.slice(start, i + 1));
          } catch {
            // not valid JSON — try the next assignment
          }
          done = true;
        }
      }
    }
  }
}

// Decode the HTML entities YouTube puts inside timedtext XML.
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// YouTube's legacy timedtext XML (used when fmt=json3 returns an empty body).
function parseTimedtextXml(xml: string): SubtitleLine[] {
  const lines: SubtitleLine[] = [];
  const re = /<text start="([\d.]+)"(?: dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g;
  for (const m of xml.matchAll(re)) {
    const text = decodeEntities(m[3] ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    lines.push({ start: parseFloat(m[1] ?? '0'), dur: parseFloat(m[2] ?? '2'), text });
  }
  return lines;
}

// Parse YouTube's json3 event format.
function parseTimedtextJson3(data: {
  events?: Array<{ tStartMs?: number; dDurationMs?: number; segs?: Array<{ utf8?: string }> }>;
}): SubtitleLine[] {
  const lines: SubtitleLine[] = [];
  for (const ev of data.events ?? []) {
    const text = (ev.segs ?? [])
      .map((s) => s.utf8 ?? '')
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    lines.push({ start: (ev.tStartMs ?? 0) / 1000, dur: (ev.dDurationMs ?? 0) / 1000, text });
  }
  return lines;
}

// Download a caption track, trying json3 first and falling back to the XML
// format (the timedtext endpoint returns an empty body for some origins).
// All requests carry the page's cookies: on bilibili the login session is
// required for AI/CC subtitles to be returned at all.
async function downloadTrack(baseUrl: string): Promise<SubtitleLine[]> {
  const url = (baseUrl.startsWith('//') ? 'https:' : '') + baseUrl;
  const json3 = await fetch(url + '&fmt=json3', { credentials: 'include' });
  if (json3.ok) {
    const text = await json3.text();
    if (text.trim()) {
      const lines = parseTimedtextJson3(JSON.parse(text));
      if (lines.length > 0) return lines;
    }
  }
  const xml = await fetch(url, { credentials: 'include' });
  if (xml.ok) {
    const lines = parseTimedtextXml(await xml.text());
    if (lines.length > 0) return lines;
  }
  throw new Error('字幕内容为空');
}

// Fallback: the InnerTube player API (public key). The ANDROID client's
// caption track URLs work cross-origin, unlike the WEB/scraped ones.
async function fetchYoutubeInnertube(
  videoId: string,
  client: 'WEB' | 'ANDROID',
): Promise<{
  title: string;
  tracks: Array<{
    baseUrl?: string;
    languageCode?: string;
    kind?: string;
    name?: { simpleText?: string };
  }>;
}> {
  const context =
    client === 'ANDROID'
      ? { clientName: 'ANDROID', clientVersion: '19.09.37', androidSdkVersion: 30, hl: 'en' }
      : { clientName: 'WEB', clientVersion: '2.20240701.00.00', hl: 'en' };
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (client === 'ANDROID') {
    headers['user-agent'] = 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip';
  }
  const res = await fetch(
    'https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
    { method: 'POST', headers, body: JSON.stringify({ context, videoId }) },
  );
  if (!res.ok) return { title: '', tracks: [] };
  const data = (await res.json().catch(() => null)) as {
    videoDetails?: { title?: string };
    captions?: {
      playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] };
    };
  } | null;
  const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  return { title: data?.videoDetails?.title ?? '', tracks };
}

interface CaptionTrack {
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
  name?: { simpleText?: string };
}

// Pick the best track: manual over auto-generated, English over others.
function bestTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  const usable = tracks.filter((t) => !!t.baseUrl);
  const sorted = [...usable].sort(
    (a, b) =>
      (b.kind === 'asr' ? 0 : 2) +
      (String(b.languageCode ?? '').startsWith('en') ? 1 : 0) -
      ((a.kind === 'asr' ? 0 : 2) + (String(a.languageCode ?? '').startsWith('en') ? 1 : 0)),
  );
  return sorted[0] ?? null;
}

// YouTube: 1) scrape the watch page, 2) InnerTube WEB, 3) InnerTube ANDROID
// (its caption URLs work cross-origin). Manual tracks and English are
// preferred over auto-generated ones.
async function fetchYoutube(videoId: string): Promise<SubtitleResult> {
  let videoTitle = '';

  const tryDownload = async (
    tracks: CaptionTrack[],
  ): Promise<{ lang: string; lines: SubtitleLine[] } | null> => {
    const track = bestTrack(tracks);
    if (!track?.baseUrl) return null;
    try {
      return {
        lang: track.name?.simpleText ?? track.languageCode ?? '',
        lines: await downloadTrack(track.baseUrl),
      };
    } catch {
      return null;
    }
  };

  // Path 1: scrape the watch page. The marker appears several times in the
  // HTML — iterate every assignment until one yields caption tracks.
  try {
    const res = await fetch(
      `https://www.youtube.com/watch?v=${videoId}&bpctr=9999999999&has_verified=1`,
    );
    if (res.ok) {
      const html = await res.text();
      for (const candidate of extractJsonAfter(html, 'ytInitialPlayerResponse')) {
        const p = candidate as {
          videoDetails?: { title?: string };
          captions?: {
            playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] };
          };
        } | null;
        videoTitle = videoTitle || (p?.videoDetails?.title ?? '');
        const picked = await tryDownload(
          p?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [],
        );
        if (picked) {
          return { platform: 'youtube', title: videoTitle, lang: picked.lang, lines: picked.lines };
        }
      }
    }
  } catch {
    // fall through to InnerTube
  }

  // Paths 2/3: InnerTube WEB, then ANDROID.
  for (const client of ['WEB', 'ANDROID'] as const) {
    const { title, tracks } = await fetchYoutubeInnertube(videoId, client);
    videoTitle = videoTitle || title;
    const picked = await tryDownload(tracks);
    if (picked) {
      return { platform: 'youtube', title: videoTitle, lang: picked.lang, lines: picked.lines };
    }
  }

  throw new Error('该视频没有可用字幕（可能未上传 CC 或被限制）');
}

// Bilibili: public view API for cid, player API for the CC subtitle list,
// then download the (uploader-added or AI-generated) subtitle JSON. All
// requests carry the page's login cookies (credentials) — without them
// bilibili returns no AI/CC subtitles at all.
async function fetchBilibili(videoId: string): Promise<SubtitleResult> {
  const view = (await (
    await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${videoId}`, {
      credentials: 'include',
    })
  ).json()) as {
    code?: number;
    message?: string;
    data?: { aid?: number; cid?: number; title?: string };
  };
  if (view.code !== 0 || !view.data?.cid) throw new Error(view.message ?? 'bilibili view 接口失败');
  const { aid, cid, title } = view.data;

  const player = (await (
    await fetch(`https://api.bilibili.com/x/player/v2?aid=${aid}&cid=${cid}`, {
      credentials: 'include',
    })
  ).json()) as {
    code?: number;
    message?: string;
    data?: {
      subtitle?: {
        subtitles?: Array<{ subtitle_url?: string; lan?: string; lan_doc?: string }>;
      };
    };
  };
  if (player.code !== 0) throw new Error(player.message ?? 'bilibili player 接口失败');

  const subs = player.data?.subtitle?.subtitles ?? [];
  if (subs.length === 0) throw new Error('该视频没有 CC 字幕（UP 主未添加，也未生成 AI 字幕）');
  const sub = subs[0];
  if (!sub?.subtitle_url) throw new Error('字幕地址为空');

  const subUrl = sub.subtitle_url.startsWith('http')
    ? sub.subtitle_url
    : `https:${sub.subtitle_url}`;
  const body = (await (await fetch(subUrl, { credentials: 'include' })).json()) as {
    body?: Array<{ from?: number; to?: number; content?: string }>;
  };

  const lines: SubtitleLine[] = (body.body ?? [])
    .filter((b) => typeof b.content === 'string')
    .map((b) => ({
      start: b.from ?? 0,
      dur: (b.to ?? 0) - (b.from ?? 0),
      text: String(b.content).trim(),
    }));
  if (lines.length === 0) throw new Error('字幕内容为空');

  return { platform: 'bilibili', title: title ?? '', lang: sub.lan_doc ?? sub.lan ?? '', lines };
}

// YouTube path: runs in the video page's content script — the watch page and
// timedtext endpoints are same-origin there. (The background SW hits origin
// restrictions on the timedtext endpoint: empty 200 bodies.)
export async function fetchYoutubeSubtitles(videoId: string): Promise<SubtitleResult> {
  return fetchYoutube(videoId);
}

// Bilibili path: runs in the background service worker — its fetch carries
// the user's bilibili login cookies (required for AI/CC subtitles) and
// bypasses CORS via host permissions.
export async function fetchBilibiliSubtitles(videoId: string): Promise<SubtitleResult> {
  return fetchBilibili(videoId);
}
