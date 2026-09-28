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
from, examples: [{ sentence, url }] }] }`. `from` is dictionary provenance
    (`"<path-relative-to-data>#<position>"`, e.g. `free-nmet/2050.json#970`)
    or `null`. Words are deduped case-insensitively; when a word already
    exists its new example is appended to `examples` unless that exact
    sentence+url is recorded already; position is max(existing) + 1. Legacy
    entries with a single `example` field are migrated on the next append.
  - `user/ai-sessions/<slug>-<hash>.json` → one AI conversation per sentence;
    the hash is derived from the normalized sentence, so re-selecting the
    same sentence resumes the same session.
- The bucket reader excludes `user/`, `monthly/`, `node_modules/`, `.git/`.

## Architecture notes

- Selection UX: a pin (small dot) appears at the selection's top-left corner.
  Single word → indigo pin → hover opens the lookup card (bucket, position,
  word, ipa, meaning, forms, TTS). Longer selections → violet pin → CLICK
  opens the in-page AI sidebar (a fixed right column rendered in the same
  shadow root; it survives page scroll). Chrome's sidePanel API is NOT used:
  sidePanel.open() requires a user gesture that content-script messages do
  not carry, so the pin cannot open a real side panel reliably.
- AI: DeepSeek via @earendil-works/pi-ai, lazy-imported. All AI calls and
  AI-session file IO run in the offscreen document (background relays);
  https://api.deepseek.com/* is a host permission so extension-context
  fetches bypass CORS.
- AI sessions: one conversation per sentence, identity = sha256 of the
  normalized sentence, stored as user/ai-sessions/<slug>-<hash>.json;
  re-selecting a sentence resumes its session.
- State: jotai atoms for popup/options shared state; plain React state inside
  ephemeral UI (chat, card).
