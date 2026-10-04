// Content script for youtube.com: captures the subtitle data the YouTube
// player itself loads. The player's own timedtext requests carry a valid
// BotGuard pot token — direct API calls from extension contexts are rejected
// (empty 200 bodies), so we inject a main-world capture hook, trigger the
// player's captions module, poll for the captured data, and respond.

import { parseTimedtextJson3, type SubtitleLine } from '@/lib/subtitles';

export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  async main() {
    // 1. Inject the main-world capture hook once per page.
    const script = document.createElement('script');
    script.src = browser.runtime.getURL('/injected.js');
    document.documentElement.append(script);
    script.remove();

    // 2. Captures arrive via window messages from the main world.
    const captures: string[] = [];
    window.addEventListener('message', (ev) => {
      if (
        ev.source === window &&
        typeof ev.data === 'object' &&
        ev.data?.type === 'linguify-captures' &&
        Array.isArray(ev.data.captures)
      ) {
        captures.push(...ev.data.captures);
      }
    });

    // 3. The panel's request: trigger caption loading, then poll.
    browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      const msg = message as { type?: string } | undefined;
      if (msg?.type !== 'pageFetchSubtitles') return false;

      void (async () => {
        window.dispatchEvent(new Event('linguify-trigger'));
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 200));
          if (captures.length > 0) break;
        }
        if (captures.length === 0) {
          throw new Error('未能从播放器捕获字幕（请确认视频已开始播放并开启 CC，然后重试）');
        }
        // Parse the most recent capture (json3 format).
        const lines: SubtitleLine[] = parseTimedtextJson3(
          JSON.parse(captures[captures.length - 1] ?? '{}'),
        );
        if (lines.length === 0) throw new Error('字幕内容为空');
        return { ok: true, lines };
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
