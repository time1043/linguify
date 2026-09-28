# Vocab Lens

Chrome MV3 extension (WXT + React 19 + TypeScript + Tailwind CSS v4 + Jotai)
that looks up any selected word on a page in a local `vocabulary-bucket`
directory, saves unknown words to its monthly file, and analyzes whole
sentences with AI (DeepSeek via `@earendil-works/pi-ai`). No backend, no
terminal: the extension reads and writes the directory directly through the
File System Access API.

## Layout

- `entrypoints/background.ts` — service worker: bucket cache (60 s TTL),
  file reads, side panel opening.
- `entrypoints/vocab-card.content/` — selection pin: single words open the
  shadow-root lookup card (bucket, position, word, ipa, meaning, forms, TTS,
  one click adds to the monthly file); longer selections open the AI panel.
- `entrypoints/sidepanel/` — AI sentence analysis chat (DeepSeek); follow-ups
  supported; one session per sentence, persisted under `user/ai-sessions/`.
- `entrypoints/offscreen/` — windowed context that performs monthly-file
  writes (`createWritable()` is unavailable in service workers).
- `entrypoints/popup/` — directory status and vocab stats.
- `entrypoints/options/` — directory pick, file-access re-grant, DeepSeek API
  key and model.
- `lib/vocab.ts` — pure lookup index (headwords + first token of each form).
- `lib/monthly.ts` — pure monthly-file merge logic (dedupe, position, `from`
  provenance).
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

1. Click the extension icon → 打开设置.
2. 选择词库文件夹 → pick the vocabulary-bucket repo root (the folder that
   contains `data/`). User-generated data is written to `user/vocab-monthly/`.
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
   appears; hovering it opens the AI side panel, analyzes the sentence
   (vocabulary, structure, idioms, translation) and answers follow-up
   questions. One session per sentence, saved to `user/ai-sessions/`;
   re-selecting the same sentence resumes that session. Requires a DeepSeek
   API key in the options page.

## Development

```sh
pnpm dev   # opens a scratch browser with the extension + HMR
```

The dev browser uses a throwaway profile — pick the directory again in its
options page. Requires a Chromium browser (File System Access API); Firefox
is not supported in this mode.
