# Linguify

Chrome MV3 extension (WXT + React 19 + TypeScript + Tailwind CSS v4 + Jotai)
that looks up any selected word on a page in a local `vocabulary-bucket`
directory, saves unknown words to its monthly file, and analyzes whole
sentences with AI (DeepSeek via `@earendil-works/pi-ai`). No backend, no
terminal: the extension reads and writes the directory directly through the
File System Access API.

## Layout

- `entrypoints/background.ts` — service worker: bucket cache (60 s TTL),
  bucket reads, message relay to the offscreen document, side panel behavior
  (toolbar-icon click opens the panel).
- `entrypoints/vocab-card.content/` — selection pin: single words open the
  shadow-root lookup card (bucket, position, word, ipa, meaning, forms, TTS,
  one click adds to the monthly file); longer selections hand the sentence to
  the side panel.
- `entrypoints/sidepanel/` — the side panel, opened by clicking the toolbar
  icon. Top settings section (directory pick/re-grant, DeepSeek key/model)
  and two tabs: 对话 (AI sentence chat — one session per sentence, follow-ups
  supported, persisted under `user/ai-sessions/`) and 生词本 (monthly word
  list with a month switcher over `user/vocab-monthly/`).
- `entrypoints/offscreen/` — windowed context for what the service worker
  cannot do: `createWritable()` file writes and the lazy-loaded pi-ai SDK.
- `lib/vocab.ts` — pure lookup index (headwords + first token of each form).
- `lib/monthly.ts` — pure monthly-file merge logic (dedupe, position, `from`
  provenance, `examples` accumulation).
- `lib/sessions.ts` — AI session identity (sentence hash) and persistence.
- `lib/ai.ts` — pi-ai integration (DeepSeek, analysis system prompt).
- `lib/fsa.ts` — File System Access layer (directory pick, permission,
  bucket reading, monthly writing).

## Build & install

```sh
pnpm install
pnpm build   # .output/chrome-mv3
```

Chrome → `chrome://extensions` → enable Developer mode → Load unpacked →
select `.output/chrome-mv3`.

## First run

1. Click the extension icon — the side panel opens.
2. Toggle 设置 at the top: 选择词库文件夹 → pick the vocabulary-bucket repo
   root (the folder that contains `data/`; user-generated data is written to
   `user/vocab-monthly/` and `user/ai-sessions/`), and paste your DeepSeek
   API key.
3. When the browser offers 「每次访问时允许」 in the permission prompt, choose
   it so access survives restarts; otherwise use 重新授权 after a restart.

## Usage

1. Select a word on any page — a small dot appears at its top-left corner.
   Hovering the dot speaks the word and opens the card with the bucket, its
   position, the word, ipa, meaning and forms; unmatched words show 没查到.
2. Click 加入月度 — the word is appended to `user/vocab-monthly/YYYY-MM.json`
   with `from` (dictionary provenance, e.g. `free-nmet/2050.json#970`, null
   when not found) and `examples: [{ sentence, url }]`. Meeting the same word
   again appends the new example; identical examples are skipped.
3. Select a whole sentence (anything longer than a word) — a violet dot
   appears; clicking it sends the sentence to the side panel's 对话 tab,
   which analyzes it (【生词】/【结构】/【短语】) and answers follow-up
   questions. One session per sentence, saved to `user/ai-sessions/`;
   re-selecting the same sentence resumes that session. Requires a DeepSeek
   API key.

## Development

```sh
pnpm dev   # opens a scratch browser with the extension + HMR
```

The dev browser uses a throwaway profile — pick the directory again in its
side panel settings. Requires a Chromium browser (File System Access API);
Firefox is not supported in this mode.
