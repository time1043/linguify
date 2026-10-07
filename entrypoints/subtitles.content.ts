// Subtitle playback controller for video pages. The side panel loads the
// user's local subtitle file (vocabulary-bucket _lib/subtitles/...) and
// hands the cues over; this script owns the <video> element: it tracks the
// current line, enforces the AB loops and handles the study hotkeys.
//
// Hotkeys (both here and in the side panel; they act on the line at the
// current playback position, i.e. the highlighted one):
//   a  previous line / d next line — they never end a loop; inside an
//      active loop they walk the loop's own lines only
//   s  toggle single-line AB loop (s s also ends a range loop)
//   z  mark loop point A (this line's start)
//   x  mark loop point B — the loop is armed here but only kicks in once
//      this line has played to its end; on the A line itself this
//      degrades to a single-line loop
//   space play/pause (panel only; the page leaves it to the site)
//   j / l playback rate −0.1 / +0.1 (hold to keep stepping)
//   Esc clear loop + marks
//
// All state and side effects live inside main() — WXT evaluates the module
// body at build time to extract the entrypoint options, so nothing may run
// at module scope.

import {
  detectPlatform,
  findCueIndexAtTime,
  MAX_RATE,
  MIN_RATE,
  RATE_STEP,
  type SubtitleCue,
  type SubtitleCommand,
  type SubtitlesLoopState,
  type SubtitlesTimeResponse,
  type SubtitlesVideoInfo,
} from '@/lib/subtitles';

interface VideoMeta extends SubtitlesVideoInfo {
  url: string;
}

export default defineContentScript({
  matches: ['https://www.youtube.com/*', 'https://www.bilibili.com/*'],
  main() {
    let meta: VideoMeta | null = null;
    let cues: SubtitleCue[] = [];
    let currentIdx = -1;
    // Loop point A waiting for its B (set with z, consumed by x).
    let pendingA: { idx: number; time: number } | null = null;
    let loop: SubtitlesLoopState | null = null;
    let video: HTMLVideoElement | null = null;
    let loopRaf = 0;
    // Playback rate, owned here and mirrored to the panel via broadcasts.
    let rate = 1;

    function currentMeta(): VideoMeta | null {
      const detected = detectPlatform(window.location.href);
      if (!detected) return null;
      return {
        platform: detected.platform,
        videoId: detected.videoId,
        title: document.title,
        url: window.location.href,
      };
    }

    // Info and playback state flow to the side panel as broadcasts; the
    // panel filters by sender.tab.id. Errors are ignored — nobody may be
    // listening.
    function broadcastInfo(): void {
      meta = currentMeta();
      void browser.runtime
        .sendMessage({ type: 'subtitlesVideo', video: meta })
        .catch(() => undefined);
    }

    function broadcastState(): void {
      void browser.runtime
        .sendMessage({
          type: 'subtitlesState',
          videoId: meta?.videoId ?? '',
          currentIdx,
          playing: video ? !video.paused : false,
          pendingAIdx: pendingA?.idx ?? null,
          loop,
          cueCount: cues.length,
          rate,
        })
        .catch(() => undefined);
    }

    // --- video element binding -------------------------------------------

    function onTimeUpdate(): void {
      recomputeCurrent();
    }

    function onSeeked(): void {
      recomputeCurrent();
      broadcastState();
    }

    function onPlayPause(): void {
      broadcastState();
    }

    function pickVideo(): HTMLVideoElement | null {
      // YouTube's main player carries a stable class; every other <video> on
      // the page (previews) is only used as a fallback.
      return document.querySelector('video.html5-main-player') ?? document.querySelector('video');
    }

    function bindVideo(el: HTMLVideoElement | null): void {
      if (el === video) return;
      if (video) {
        video.removeEventListener('timeupdate', onTimeUpdate);
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('play', onPlayPause);
        video.removeEventListener('pause', onPlayPause);
      }
      video = el;
      if (video) {
        video.addEventListener('timeupdate', onTimeUpdate);
        video.addEventListener('seeked', onSeeked);
        video.addEventListener('play', onPlayPause);
        video.addEventListener('pause', onPlayPause);
        // A fresh element resets to 1x — re-apply the user's rate so it
        // survives SPA navigations between videos.
        if (rate !== 1) video.playbackRate = rate;
        recomputeCurrent();
        broadcastState();
      }
    }

    // Video elements come and go across SPA navigations, so keep polling.
    setInterval(() => {
      bindVideo(pickVideo());
    }, 500);

    // --- navigation watching (YouTube/Bilibili are SPAs) ------------------

    function onNavigation(): void {
      const previousVideoId = meta?.videoId;
      broadcastInfo();
      if (meta?.videoId === previousVideoId) return;
      // New video (or left a video page): loops and marks belonged to the
      // old timeline. Cues are kept and reactivate when the same video
      // returns.
      stopLoopTicker();
      loop = null;
      pendingA = null;
      currentIdx = -1;
      bindVideo(pickVideo());
      broadcastState();
    }

    let lastUrl = window.location.href;
    setInterval(() => {
      if (window.location.href === lastUrl) return;
      lastUrl = window.location.href;
      onNavigation();
    }, 600);

    // --- playback helpers -------------------------------------------------

    function recomputeCurrent(): void {
      const idx = findCueIndexAtTime(cues, video?.currentTime ?? -1);
      if (idx !== currentIdx) {
        currentIdx = idx;
        broadcastState();
      }
    }

    function seekTo(time: number): void {
      if (!video) return;
      video.currentTime = time;
      if (video.paused) void video.play().catch(() => undefined);
    }

    function stopLoopTicker(): void {
      if (loopRaf) cancelAnimationFrame(loopRaf);
      loopRaf = 0;
    }

    // While a loop is active, rAF keeps the playhead inside [start, end):
    // the ~4Hz timeupdate alone would overshoot into the next line audibly.
    // Pausing (space) inside the loop keeps the position — only *playback*
    // is confined, so the user can still scrub while paused.
    function startLoopTicker(): void {
      stopLoopTicker();
      const tick = (): void => {
        loopRaf = 0;
        if (!video || !loop) return;
        const t = video.currentTime;
        if (!video.paused && (t >= loop.end - 0.01 || t < loop.start - 0.25)) {
          video.currentTime = loop.start;
        }
        loopRaf = requestAnimationFrame(tick);
      };
      loopRaf = requestAnimationFrame(tick);
    }

    // --- commands -----------------------------------------------------------

    function clearLoopState(): void {
      stopLoopTicker();
      loop = null;
      pendingA = null;
    }

    function runCommand(cmd: SubtitleCommand): void {
      if (cmd === 'cancelLoop') {
        clearLoopState();
        toast('已清除循环');
        broadcastState();
        return;
      }
      // Play/pause and rate must work without subtitles loaded too.
      if (cmd === 'togglePlay') {
        if (!video) return;
        if (video.paused) void video.play().catch(() => undefined);
        else video.pause();
        broadcastState();
        return;
      }
      if (cmd === 'rateUp' || cmd === 'rateDown') {
        if (!video) return;
        const step = cmd === 'rateUp' ? RATE_STEP : -RATE_STEP;
        rate = Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round((rate + step) * 10) / 10));
        video.playbackRate = rate;
        toast(`倍速 ${rate.toFixed(1)}x`);
        broadcastState();
        return;
      }
      if (cues.length === 0) {
        toast('字幕未加载');
        return;
      }
      if (cmd === 'markA') {
        if (currentIdx < 0) return;
        stopLoopTicker();
        loop = null;
        pendingA = { idx: currentIdx, time: cues[currentIdx]!.start };
        toast(`A 点：第 ${currentIdx + 1} 句开头，到结束句后按 x`);
        broadcastState();
        return;
      }
      if (cmd === 'markB') {
        if (!pendingA) {
          toast('请先按 z 设置 A 点');
          return;
        }
        if (currentIdx < 0) return;
        if (currentIdx < pendingA.idx) {
          toast('B 点必须在 A 点之后');
          return;
        }
        // B marks the END line: the loop plays through the end of the line x
        // was pressed on, so x on the last wanted line includes it. On the A
        // line itself this degrades to a single-line loop. The loop is only
        // armed here — no seek — so the B line finishes playing first and
        // the jump back to A happens when it ends.
        const endTime = cues[currentIdx]!.end;
        const lastIdx = currentIdx;
        const kind: SubtitlesLoopState['kind'] = currentIdx === pendingA.idx ? 'single' : 'range';
        loop = {
          kind,
          start: pendingA.time,
          end: endTime,
          aIdx: pendingA.idx,
          bIdx: currentIdx,
          lastIdx,
        };
        pendingA = null;
        startLoopTicker();
        toast(
          kind === 'single'
            ? `单句循环：第 ${loop.aIdx + 1} 句，本句播完开始`
            : `AB 循环：第 ${loop.aIdx + 1}–${loop.lastIdx + 1} 句，本句播完开始`,
        );
        broadcastState();
        return;
      }
      if (cmd === 'toggleSingle') {
        if (currentIdx < 0) return;
        if (loop?.kind === 'single' && loop.aIdx === currentIdx) {
          stopLoopTicker();
          loop = null;
          toast('已停止循环');
          broadcastState();
          return;
        }
        const cue = cues[currentIdx]!;
        loop = {
          kind: 'single',
          start: cue.start,
          end: cue.end,
          aIdx: currentIdx,
          bIdx: currentIdx,
          lastIdx: currentIdx,
        };
        pendingA = null;
        seekTo(cue.start);
        startLoopTicker();
        toast(`单句循环：第 ${currentIdx + 1} 句`);
        broadcastState();
        return;
      }
      // prev / next never touch loop state — a running loop is only ended
      // by s s (or Esc to cancel). Inside an active loop they walk the loop's own
      // lines, clamped at its edges.
      const wanted =
        cmd === 'prev'
          ? Math.max(0, currentIdx <= 0 ? 0 : currentIdx - 1)
          : Math.min(cues.length - 1, currentIdx < 0 ? 0 : currentIdx + 1);
      const target = loop ? Math.min(Math.max(wanted, loop.aIdx), loop.bIdx) : wanted;
      seekTo(cues[target]!.start);
      currentIdx = target;
      toast(`第 ${target + 1} 句`);
      broadcastState();
    }

    // --- messages from the side panel --------------------------------------

    browser.runtime.onMessage.addListener((message: unknown) => {
      const msg = message as
        | {
            type?: string;
            videoId?: string;
            cues?: SubtitleCue[];
            time?: number;
            cmd?: SubtitleCommand;
            rate?: number;
          }
        | undefined;
      if (msg?.type === 'subtitlesRequestInfo') {
        broadcastInfo();
        return;
      }
      if (msg?.type === 'subtitlesGetTime') {
        // Notes stamps the playhead at button press; the polyfill needs a
        // promise return for the response to reach tabs.sendMessage.
        if (!meta || !video || (msg.videoId != null && msg.videoId !== meta.videoId)) {
          return Promise.resolve(null);
        }
        return Promise.resolve({
          videoId: meta.videoId,
          time: video.currentTime,
          currentIdx,
        } satisfies SubtitlesTimeResponse);
      }
      if (msg?.type === 'subtitlesSetCues') {
        // The panel may be a beat behind a navigation; never apply another
        // video's cues.
        if (!meta || msg.videoId !== meta.videoId) return;
        // Reloading the same file (panel remount, tab switch back) must not
        // kill a running loop — only the first load resets the marks.
        const firstLoad = cues.length === 0;
        cues = [...(msg.cues ?? [])].sort((a, b) => a.start - b.start);
        if (firstLoad) {
          clearLoopState();
          currentIdx = -1;
          toast(`已加载 ${cues.length} 句字幕`);
        }
        recomputeCurrent();
        broadcastState();
        return;
      }
      if (msg?.type === 'subtitlesSeek') {
        if (!meta || msg.videoId !== meta.videoId) return;
        seekTo(msg.time ?? 0);
        recomputeCurrent();
        broadcastState();
        return;
      }
      if (msg?.type === 'subtitlesSetRate') {
        if (!meta || msg.videoId !== meta.videoId || !video) return;
        rate = Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round((msg.rate ?? 1) * 10) / 10));
        video.playbackRate = rate;
        broadcastState();
        return;
      }
      if (msg?.type === 'subtitlesCommand') {
        if (meta && msg.videoId && msg.videoId !== meta.videoId) return;
        if (msg.cmd) runCommand(msg.cmd);
      }
    });

    // --- hotkeys -------------------------------------------------------------

    const keyCommands: Record<string, SubtitleCommand> = {
      a: 'prev',
      d: 'next',
      s: 'toggleSingle',
      z: 'markA',
      x: 'markB',
      j: 'rateDown',
      l: 'rateUp',
    };

    document.addEventListener(
      'keydown',
      (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
        )
          return;
        if (e.key === 'Escape') {
          // Esc exits fullscreen first; don't fight it.
          if (document.fullscreenElement) return;
          if (!loop && !pendingA) return;
          e.preventDefault();
          runCommand('cancelLoop');
          return;
        }
        const cmd = keyCommands[e.key.toLowerCase()];
        if (!cmd) return;
        // Holding a/d to walk through lines and j/l to ramp the rate is
        // useful; the marking keys must not auto-repeat.
        if (e.repeat && cmd !== 'prev' && cmd !== 'next' && cmd !== 'rateUp' && cmd !== 'rateDown')
          return;
        e.preventDefault();
        e.stopImmediatePropagation();
        runCommand(cmd);
      },
      true,
    );

    // --- toast ---------------------------------------------------------------

    let toastEl: HTMLDivElement | null = null;
    let toastTimer = 0;

    function toast(text: string): void {
      if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.style.cssText =
          'position:fixed;z-index:2147483647;padding:6px 14px;border-radius:999px;' +
          'background:rgba(24,24,27,.85);color:#fff;font-size:13px;line-height:1.4;' +
          'pointer-events:none;transition:opacity .25s;opacity:0;';
        document.documentElement.append(toastEl);
      }
      const rect = video?.getBoundingClientRect();
      if (rect && rect.width > 0) {
        toastEl.style.top = `${rect.top + 18}px`;
        toastEl.style.left = `${rect.left + rect.width / 2}px`;
      } else {
        toastEl.style.top = '18px';
        toastEl.style.left = '50%';
      }
      toastEl.style.transform = 'translateX(-50%)';
      toastEl.textContent = text;
      toastEl.style.opacity = '1';
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => {
        if (toastEl) toastEl.style.opacity = '0';
      }, 1600);
    }

    broadcastInfo();
  },
});
