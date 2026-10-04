// Background service worker: owns the vocabulary cache and all access to the
// user's vocabulary-bucket directory (via the File System Access API). The
// content script and popup only talk to it through runtime messages.

import type { AddWordResponse, LookupResponse, RefreshResponse } from '@/lib/types';

import { VocabAccessError, getBucketDir, readBuckets } from '@/lib/fsa';
import { aiApiKeyItem, aiModelItem, aiPendingSessionItem } from '@/lib/settings';
import { detectPlatform, fetchBilibiliSubtitles } from '@/lib/subtitles';
import { buildVocabIndex, lookupWord, normalizeWord, type VocabIndex } from '@/lib/vocab';

const VOCAB_TTL_MS = 60_000;

// The service worker has no createWritable(), so monthly-file writes are
// delegated to an offscreen document (entrypoints/offscreen).
interface OffscreenApi {
  hasDocument(): Promise<boolean>;
  createDocument(options: { url: string; reasons: string[]; justification: string }): Promise<void>;
}

async function ensureOffscreenDocument(): Promise<void> {
  const offscreen = (browser as unknown as { offscreen?: OffscreenApi }).offscreen;
  if (!offscreen) throw new Error('chrome.offscreen API unavailable');
  if (await offscreen.hasDocument()) return;
  await offscreen.createDocument({
    url: browser.runtime.getURL('/offscreen.html'),
    reasons: ['BLOBS'],
    justification: 'Write vocabulary files and run AI calls in a windowed context',
  });
  // createDocument resolves before the offscreen page's scripts have
  // registered their onMessage listeners — give it a moment, otherwise the
  // first relayed message resolves with null ("no listener responded").
  await sleep(300);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Relay a message to the offscreen document, retrying briefly while the
// freshly created document finishes booting.
async function relayToOffscreen(message: unknown): Promise<unknown> {
  await ensureOffscreenDocument();
  for (let attempt = 0; attempt < 4; attempt++) {
    const result = await browser.runtime.sendMessage(message);
    if (result) return result;
    await sleep(400);
  }
  throw new Error('offscreen did not respond');
}

interface VocabCache {
  index: VocabIndex;
  fetchedAt: number;
}

let cache: VocabCache | null = null;

async function fetchVocabIndex(): Promise<VocabIndex> {
  const dir = await getBucketDir();
  if (!dir) throw new VocabAccessError('NO_DIR');
  try {
    return buildVocabIndex(await readBuckets(dir));
  } catch (err) {
    // File access without a granted permission throws NotAllowedError.
    if (err instanceof VocabAccessError) throw err;
    if (err instanceof DOMException && err.name === 'NotAllowedError')
      throw new VocabAccessError('NO_PERMISSION');
    throw err;
  }
}

// Serve lookups from a short-lived cache so rapid selections do not re-read
// files. With allowStale, a failed refresh falls back to the previous snapshot.
async function getVocabIndex(
  options: { force?: boolean; allowStale?: boolean } = {},
): Promise<VocabIndex> {
  const { force = false, allowStale = false } = options;
  if (!force && cache && Date.now() - cache.fetchedAt < VOCAB_TTL_MS) return cache.index;
  try {
    const index = await fetchVocabIndex();
    cache = { index, fetchedAt: Date.now() };
    return index;
  } catch (err) {
    if (allowStale && cache) return cache.index;
    throw err;
  }
}

function errorCode(err: unknown): string {
  if (err instanceof VocabAccessError) return err.code;
  if (err instanceof DOMException && err.name === 'NotAllowedError') return 'NO_PERMISSION';
  return err instanceof Error ? err.message : String(err);
}

// Message types handled by the offscreen document; the service worker only
// relays them (the SW itself cannot createWritable() or dynamic-import).
const OFFSCREEN_TYPES = new Set([
  'writeMonthly',
  'loadAiSession',
  'saveAiSession',
  'listAiSessions',
  'listMonthly',
  'readMonthly',
]);

export default defineBackground(() => {
  // Clicking the toolbar icon opens the side panel — the panel hosts the
  // settings (directory, API key) and both feature tabs.
  const sidePanel = (
    browser as unknown as {
      sidePanel?: {
        setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void>;
        open(options: { tabId: number }): Promise<void>;
      };
    }
  ).sidePanel;
  void sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

  browser.runtime.onMessage.addListener(async (message: unknown, sender): Promise<unknown> => {
    const { type } = (message ?? {}) as { type?: string };
    if (type === 'openAiPanel') {
      // The violet pin hands its sentence over and asks for the panel. When
      // Chrome refuses the gesture the sentence stays queued; the next icon
      // click opens the panel and the storage watcher picks it up.
      try {
        const { sentence, url } = (message ?? {}) as { sentence?: string; url?: string };
        if (!sentence) return { ok: false, error: 'no sentence' };
        await aiPendingSessionItem.setValue({ sentence, url: url ?? '', ts: Date.now() });
        if (!sidePanel) throw new Error('side panel unavailable');
        const tabId = (sender as { tab?: { id?: number } } | undefined)?.tab?.id;
        if (tabId == null) throw new Error('sender tab unknown');
        await sidePanel.open({ tabId });
        return { ok: true };
      } catch {
        return { ok: false, error: 'GESTURE' };
      }
    }
    if (type === 'fetchSubtitles') {
      const BUILD_MARK = 'bg-v7';
      // Split by platform: YOUTUBE subtitles are fetched in the video page's
      // content script (the timedtext endpoint is same-origin only there —
      // the SW gets empty 200 bodies); BILIBILI subtitles are fetched here in
      // the SW, whose fetch carries the user's bilibili login cookies
      // (required for AI/CC subtitles) and bypasses CORS via host permissions.
      try {
        const { url, tabId } = (message ?? {}) as { url?: string; tabId?: number };
        if (!url) return { ok: false, error: 'no url' };
        const detected = detectPlatform(url);
        if (!detected) return { ok: false, error: '不是支持的视频页面' };

        if (detected.platform === 'bilibili') {
          return { ok: true, ...(await fetchBilibiliSubtitles(detected.videoId)) };
        }

        // Prefer the sender's own tab (the video page) — most specific.
        let target = tabId ?? (sender as { tab?: { id?: number } } | undefined)?.tab?.id;
        if (target == null) {
          // Fall back to the focused window's active tab.
          const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
          target = tab?.id;
        }
        if (target == null) {
          // Last resort: find any open video page tab.
          const [tab] = await browser.tabs.query({
            url: ['*://www.youtube.com/watch*', '*://www.bilibili.com/video*'],
          });
          target = tab?.id;
        }
        console.log(
          `[fetchSubtitles] url=${url.slice(0, 60)} senderTab=${
            (sender as { tab?: { id?: number } } | undefined)?.tab?.id ?? 'none'
          } target=${target ?? 'NONE'}`,
        );
        if (target == null) {
          const allTabs = await browser.tabs.query({});
          const tabList = allTabs
            .map((t) => `${t.id}:${(t.url || 'about:blank').slice(0, 60)}`)
            .join(' | ');
          throw new Error(`未找到视频标签页（当前标签页: ${tabList}）`);
        }
        const result = (await browser.tabs.sendMessage(target, {
          type: 'pageFetchSubtitles',
          url,
        })) as Record<string, unknown> | undefined;
        if (!result) throw new Error('内容脚本未响应（请刷新视频页面后重试）');
        return result;
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    if (type && OFFSCREEN_TYPES.has(type)) {
      try {
        const result = await relayToOffscreen(message);
        return result;
      } catch (err) {
        return { ok: false, error: errorCode(err) };
      }
    }
    if (type === 'aiChatRequest') {
      // The side panel asks for a completion. The offscreen document has no
      // chrome.storage API, so the AI settings are read here (SW context)
      // and injected into the relayed 'aiChat' message.
      try {
        const { messages } = (message ?? {}) as { messages?: unknown };
        if (!Array.isArray(messages)) return { ok: false, error: 'no messages' };
        const [apiKey, model] = await Promise.all([
          aiApiKeyItem.getValue(),
          aiModelItem.getValue(),
        ]);
        // Debug aid (temporary): the panel shows this in the error text, so
        // the user can report what the background actually read — no devtools
        // or terminal needed.
        const storedKeys = Object.keys(await browser.storage.local.get(null)).join(', ');
        const masked = apiKey
          ? `${apiKey.slice(0, 6)}…${apiKey.slice(-4)} (len ${apiKey.length})`
          : '(EMPTY)';
        console.log(`[aiChat] key=${masked} model=${model} storage=[${storedKeys}]`);
        if (!apiKey)
          return {
            ok: false,
            error: `NO_API_KEY（后台读到 Key: ${masked}｜storage 现有键: ${storedKeys}｜处理实例: ${browser.runtime.id}）`,
          };
        const result = await relayToOffscreen({
          type: 'aiChat',
          messages,
          apiKey,
          model,
        });
        return result;
      } catch (err) {
        return { ok: false, error: errorCode(err) };
      }
    }
    switch (type) {
      case 'lookup': {
        try {
          const { word } = message as { word: string };
          const index = await getVocabIndex({ allowStale: true });
          return { hit: lookupWord(index, word) } satisfies LookupResponse;
        } catch (err) {
          return { hit: null, error: errorCode(err) } satisfies LookupResponse;
        }
      }
      case 'refreshVocab': {
        try {
          const index = await getVocabIndex({ force: true });
          return { ok: true, stats: index.stats } satisfies RefreshResponse;
        } catch (err) {
          return { ok: false, error: errorCode(err) } satisfies RefreshResponse;
        }
      }
      case 'addWord': {
        try {
          const { word, example } = message as {
            word: string;
            example: { sentence: string; url: string };
          };
          // Record where the word was found, e.g. "free-nmet/2050.json#970".
          // Provenance is best-effort; the write works without it too.
          let from: string | null = null;
          try {
            const hit = lookupWord(await getVocabIndex({ allowStale: true }), word);
            if (hit) from = `${hit.bucket.path}#${hit.entry.position}`;
          } catch {
            // Provenance is best-effort.
          }
          const result = (await relayToOffscreen({
            type: 'writeMonthly',
            word: normalizeWord(word) ?? word,
            from,
            example,
          })) as AddWordResponse;
          return result;
        } catch (err) {
          return { ok: false, error: errorCode(err) } satisfies AddWordResponse;
        }
      }
      default:
        return undefined;
    }
  });
});
