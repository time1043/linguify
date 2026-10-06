# Conventions

Agreed development conventions for this repository. Keep this file current
when conventions change.

## Git

- Short-lived feature branches (`feat/<topic>`); integration happens on the
  MVP branch (`mvp/260928`).
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
- `_lib/` — user-generated data, written by the extension (renamed from
  `user/` so it sorts away from `data/`; a legacy `user/` is still read):
  - `_lib/vocab-monthly/YYYY-MM.json` → `{ name, words: [{ position, word,
from, examples: [{ sentence, url }] }] }`. `from` is dictionary provenance
    (`"<path-relative-to-data>#<position>"`, e.g. `free-nmet/2050.json#970`)
    or `null`. Words are deduped case-insensitively; when a word already
    exists its new example is appended to `examples` unless that exact
    sentence+url is recorded already; position is max(existing) + 1. Legacy
    entries with a single `example` field are migrated on the next append.
  - `_lib/ai-sessions/<slug>-<hash>.json` → one AI conversation per sentence;
    the hash is derived from the normalized sentence, so re-selecting the
    same sentence resumes the same session.
  - `_lib/subtitles/<platform>/<uploader>/` → user-provided `.srt` files plus
    a `map.json` mapping videoId → subtitle file.
  - `_lib/notes/<platform>/<uploader>/` → markdown notes mirroring the
    subtitle file names.
- The bucket reader excludes `_lib/`, `monthly/`, `node_modules/`, `.git/`.

## Architecture notes

- Selection UX: a pin (small dot) appears at the selection's top-left corner.
  Single word → indigo pin → hover opens the pinned lookup card (bucket,
  position, word, ipa, meaning, forms, TTS); it closes on a click outside it
  (or Escape / scroll / a new selection). Longer selections → violet pin →
  click hands the sentence to the side panel. The toolbar icon always opens
  the side panel (openPanelOnActionClick); there is no popup. If
  chrome.sidePanel.open() lacks a usable gesture the sentence stays queued
  in chrome.storage and is picked up on the next icon click.
- Side panel tabs: 对话 (AI chat, one session per sentence, pending-session
  handoff through chrome.storage + storage.watch), 生词本 (monthly word list,
  month switcher over \_lib/vocab-monthly/YYYY-MM.json), 字幕 (subtitle list
  synced to the video's playhead, click-to-seek, study hotkeys, A–B looping)
  and 记笔记 (markdown notes mirroring the subtitle path, WYSIWYG/source/
  preview). Panel-top settings cover the directory pick/re-grant and the
  DeepSeek key/model — there is no separate options page.
- AI: DeepSeek via @earendil-works/pi-ai (lazy-imported). AI calls and
  AI-session file IO run in the offscreen document (background relays);
  https://api.deepseek.com/* is a host permission so extension-context
  fetches bypass CORS.
- AI sessions: one conversation per sentence, identity = sha256 of the
  normalized sentence, stored as \_lib/ai-sessions/<slug>-<hash>.json;
  re-selecting a sentence resumes its session.
- Bucket directory permissions: the grant lives in memory per browser
  session; the panel restores it gesture-less when possible, otherwise on
  the first click anywhere in the panel (see entrypoints/sidepanel/
  use-bucket-dir.ts).
- State: jotai atoms where shared state exists; plain React state inside
  ephemeral UI (chat, card).
