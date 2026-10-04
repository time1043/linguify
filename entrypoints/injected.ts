// Injected into the MAIN world of youtube.com. The YouTube player's own
// caption requests carry a valid BotGuard pot token — direct API calls from
// extension contexts are rejected with empty 200 bodies. This script hooks
// the page's network calls, captures timedtext responses, and exposes a
// trigger/pull API for the content script (which cannot access page globals).

export default defineUnlistedScript(() => {
  interface MainWorld {
    __linguifyHooked?: boolean;
    __linguifyCaptures?: string[];
    __linguifyTrigger?: () => void;
    __linguifyGetCaptures?: () => string;
    fetch: typeof fetch;
  }
  const w = window as unknown as MainWorld;
  if (w.__linguifyHooked) return;

  w.__linguifyHooked = true;
  w.__linguifyCaptures = [];
  const captures = w.__linguifyCaptures;
  const capture = (text: string) => {
    if (text) captures.push(text);
  };

  // Hook fetch: capture timedtext responses as they pass through.
  if (typeof w.fetch === 'function') {
    const origFetch = w.fetch.bind(w);
    w.fetch = (...args: Parameters<typeof fetch>) => {
      const promise = origFetch(...args);
      if (String(args[0]).includes('/api/timedtext')) {
        promise
          .then((res) =>
            res
              .clone()
              .text()
              .then((t) => capture(t)),
          )
          .catch(() => {});
      }
      return promise;
    };
  }

  // Trigger: load the player's captions module (fetches the current video's
  // timedtext through the hooked layer).
  w.__linguifyTrigger = () => {
    try {
      const player = document.querySelector('#movie-player') as {
        loadModule?: (module: string) => void;
        setOption?: (module: string, key: string, value: unknown) => void;
      } | null;
      player?.loadModule?.('captions');
      player?.setOption?.('captions', 'track', { languageCode: 'en' });
    } catch {}
  };

  // Pull API for the content script (used via chrome.scripting MAIN world).
  w.__linguifyGetCaptures = () => JSON.stringify(captures);
});
