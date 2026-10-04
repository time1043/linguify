// Content script for video pages: fetches YOUTUBE subtitles same-origin
// (the watch page and timedtext endpoints only work from the youtube origin,
// so the background cannot do it). Bilibili subtitles are fetched by the
// background worker instead — its fetch carries the login cookies required
// for AI/CC subtitles, and host permissions bypass CORS.

import { fetchYoutubeSubtitles } from '@/lib/subtitles';

export default defineContentScript({
  matches: ['https://www.youtube.com/*', 'https://www.bilibili.com/*'],
  async main() {
    browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      const msg = message as { type?: string; url?: string } | undefined;
      if (msg?.type !== 'pageFetchSubtitles') return false;

      const parsed = new URL(msg.url ?? window.location.href);
      // youtube watch URLs carry ?v=; /shorts/ carries the id in the path
      const videoId =
        parsed.searchParams.get('v') ?? parsed.pathname.match(/\/shorts\/([\w-]{11})/)?.[1] ?? null;
      void (async () => {
        if (!videoId) throw new Error('不是 YouTube 视频页面');
        // youtube → same-origin fetch here; bilibili → the background
        // handles it directly (its fetch carries the login cookies)
        return { ok: true, ...(await fetchYoutubeSubtitles(videoId)) };
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
