// Injected into the MAIN world of youtube.com. The YouTube player's own
// caption requests carry a valid BotGuard pot token — direct API calls from
// extension contexts are rejected with empty bodies. This script hooks the
// page's network calls, captures the timedtext responses, and exposes them
// to the content script via window.postMessage.

export default defineUnlistedScript(() => {
  const w = window as unknown as {
    __linguifyHooked?: boolean;
    __linguifyCaptures?: string[];
    fetch: typeof fetch;
  };
  if (w.__linguifyHooked) return;
  w.__linguifyHooked = true;
  w.__linguifyCaptures = [];

  const capture = (text: string) => {
    try {
      w.__linguifyCaptures?.push(text);
      window.postMessage({ type: 'linguify-captures' }, '*');
    } catch {}
  };

  // Hook fetch: capture timedtext responses as they pass through.
  const origFetch = w.fetch.bind(w);
  w.fetch = (...args: Parameters<typeof fetch>) => {
    const promise = origFetch(...args);
    const url = String(args[0]);
    if (url.includes('/api/timedtext')) {
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

  // Hook XHR too (the player uses XHR for some caption formats).
  const origOpen = XMLHttpRequest.prototype.open as (...args: unknown[]) => void;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]) {
    const url = String(args[1] ?? '');
    if (url.includes('/api/timedtext')) {
      this.addEventListener('load', () => capture(String(this.responseText ?? '')));
    }
    return origOpen.apply(this, args);
  } as typeof XMLHttpRequest.prototype.open;

  // Trigger: make the player load its captions module so it fetches the
  // current video's timedtext through the hooked network layer.
  window.addEventListener('linguify-trigger', () => {
    try {
      const player = document.querySelector('#movie-player') as {
        loadModule?: (m: string) => void;
      } | null;
      player?.loadModule?.('captions');
    } catch {}
  });
  window.dispatchEvent(new Event('linguify-trigger'));
});
