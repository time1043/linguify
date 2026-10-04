// Subtitle fetching on video pages. The content script runs ON the video
// page, so requests to youtube.com / bilibili.com are same-origin — no CORS,
// no proxy quirks. The background relays the panel's request here.

import { fetchSubtitles } from '@/lib/subtitles';

export default defineContentScript({
  matches: ['https://www.youtube.com/*', 'https://www.bilibili.com/*'],
  async main() {
    browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      const msg = message as { type?: string; url?: string } | undefined;
      if (msg?.type !== 'pageFetchSubtitles') return false;

      const url = msg.url ?? window.location.href;
      void fetchSubtitles(url)
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((err) =>
          sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
        );

      // Keep the message channel open for the async response.
      return true;
    });
  },
});
