# Conventions

Agreed development conventions for this repository. Keep this file current
when conventions change.

## Git

- ONE feature branch at a time: `feat/vocab-lens`. All work happens there.
- Commit small and granular; one concern per commit; conventional prefixes
  (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `style:`, `test:`).
- Merge into `mvp/260928` ONLY when the user explicitly asks. Never merge
  after each commit on your own.
- Merge commits carry a real message: a one-line summary plus bullets
  describing what the merge delivers.

## Language

- Code, comments, docs: English.
- User-facing UI copy: Chinese.

## Tooling

- Package manager: pnpm (`pnpm`, not npm/yarn).
- Formatter: oxfmt (`pnpm fmt` / `pnpm fmt:check`); run before committing.
- Line endings: LF for everyone (`* text=auto eol=lf` in `.gitattributes`).
- Network commands need the proxy: `export https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890` (the shell alias is `ex`).
- Gates before committing: `pnpm compile` (tsc), `pnpm build` (wxt), `pnpm fmt:check`.

## Domain data (vocabulary-bucket)

The extension talks to a local checkout of the `vocabulary-bucket` repo via
the File System Access API (no backend server):

- `data/` — dictionary buckets, read-only for the extension.
  `data/<group>/<bucket>.json` → `{ name, words: [{ position, word, ipa,
meaning, forms }] }`. Forms look like `"changed v."`; the lookup key is the
  first token.
- `user/` — user-generated data, written by the extension:
  - `user/vocab-monthly/YYYY-MM.json` → `{ name, words: [{ position, word,
from, example: { sentence, url } }] }`. `from` is dictionary provenance
    (`"<path-relative-to-data>#<position>"`, e.g. `free-nmet/2050.json#970`)
    or `null`. Duplicates are skipped (case-insensitive); position is
    max(existing) + 1.
  - `user/ai-sessions/<slug>-<hash>.json` → one AI conversation per sentence;
    the hash is derived from the normalized sentence, so re-selecting the
    same sentence resumes the same session.
- The bucket reader excludes `user/`, `monthly/`, `node_modules/`, `.git/`.

## Architecture notes

- Selection UX: a pin (small dot) appears at the selection's top-left corner.
  Single word → indigo pin → hover opens the lookup card (bucket, position,
  word, ipa, meaning, forms, TTS). Longer selections → violet pin → opens the
  AI side panel (sentence analysis, follow-ups via DeepSeek through
  `@earendil-works/pi-ai`).
- File System Access: the directory handle lives in IndexedDB. Reads run in
  the service worker; writes must go through a windowed context because
  `createWritable()` is unavailable in MV3 service workers — monthly writes
  are delegated to an offscreen document, session writes happen directly in
  the side panel.
- Side panel handoff: the content script stores a pending session in
  `chrome.storage` and calls `chrome.sidePanel.open()`; if Chrome refuses the
  gesture, the popup shows an 「AI 分析」 button (clicking the toolbar icon
  always opens the popup, never the panel). The panel watches storage and
  picks up the pending session either way.
- State: jotai atoms for popup/options shared state; plain React state inside
  ephemeral UI (chat, card).
