// Content script for youtube.com: captures the subtitle data the YouTube
// player itself loads. The player's own timedtext requests carry a valid
// BotGuard pot token — direct API calls from extension contexts are rejected
// (empty 200 bodies), so we install a main-world hook that captures the
// player's caption responses and expose a trigger/pull API for the panel.
import { parseTimedtextJson3, type SubtitleLine } from '@/lib/subtitles';

// MAIN-world snippets for chrome.scripting.executeScript (closures do not
// transfer across the injection boundary — each snippet is self-contained).
const INSTALL_CAPTURE = `() => {
  const w = window;
  if (w.__linguifyHooked) return;
  w.__linguifyHooked = true;
  w.__linguifyCaptures = [];
  const capture = (text) => { if (text) w.__linguifyCaptures.push(text); };
  if (typeof w.fetch === 'function') {
    const origFetch = w.fetch.bind(w);
    w.fetch = function (...args) {
      const p = origFetch.apply(w, args);
      if (String(args[0]).includes('/api/timedtext')) {
        p.then((res) => res.clone().text().then(capture)).catch(() => {});
      }
      return p;
    };
  }
}`;

const TRIGGER = `() => {
  try {
    const player = document.querySelector('#movie-player');
    if (player) {
      if (player.loadModule) player.loadModule('captions');
      if (player.setOption) player.setOption('captions', 'track', { languageCode: 'en' });
    }
  } catch {}
}`;

const GET_CAPTURES = `() => JSON.stringify(window.__linguifyCaptures || [])`;

export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  async main() {
    browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      const msg = message as { type?: string; tabId?: number } | undefined;
      if (msg?.type !== 'pageFetchSubtitles') return false;

      void (async () => {
        const tabId = msg.tabId;
        if (tabId == null) throw new Error('未找到视频标签页');

        // 1. install the main-world timedtext capture hook
        await browser.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: eval(INSTALL_CAPTURE),
        });

        // 2. trigger the player's captions module (fetches timedtext)
        await browser.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: eval(TRIGGER),
        });

        // 3. poll the captured timedtext (up to ~8s)
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 200));
          const raw = (await browser.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: eval(GET_CAPTURES),
          })) as unknown as string;
          const captures = (JSON.parse(raw || '[]') as string[]).filter(
            (c): c is string => typeof c === 'string',
          );
          const last = captures.at(-1);
          if (captures.length > 0 && last) {
            // Parse the most recent capture (json3 format).
            const lines: SubtitleLine[] = parseTimedtextJson3(JSON.parse(last));
            if (lines.length === 0) throw new Error('字幕内容为空');
            return { ok: true, lines };
          }
        }
        throw new Error('未能从播放器捕获字幕（请确认视频已开始播放，然后重试）');
      })()
        .then((result) => sendResponse(result))
        .catch((err) =>
          sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
        );

      // Keep the message channel open for the async response.
      return true;
    });
  },
});
