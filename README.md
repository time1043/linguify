# Vocab Lens

Chrome MV3 extension (WXT + React 19 + TypeScript + Tailwind CSS v4 + Jotai)
that looks up any selected word on a page in a local `vocabulary-bucket`
directory and saves unknown words to its monthly file. No backend, no
terminal: the extension reads and writes the directory directly through the
File System Access API.

## Layout

- `entrypoints/background.ts` — service worker: bucket cache (60 s TTL) and
  all file access.
- `entrypoints/vocab-card.content/` — shadow-root card shown on word
  selection: bucket, position, word, ipa, meaning, forms (or 没查到); one click
  adds the word to the monthly file together with the enclosing sentence and
  page URL.
- `entrypoints/popup/` — directory status and vocab stats.
- `entrypoints/options/` — pick the vocabulary-bucket directory, re-grant
  file access, re-read stats.
- `lib/vocab.ts` — pure lookup index (headwords + first token of each form).
- `lib/monthly.ts` — pure monthly-file merge logic (dedupe, position).
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
   contains `data/`). `monthly/` is created at the same level.
3. When the browser offers 「每次访问时允许」 in the permission prompt, choose
   it so access survives restarts; otherwise use 重新授权 after a restart.

## Usage

1. Select a word on any page — a small dot appears at its top-left corner.
   Hovering the dot speaks the word and opens the card with the bucket, its
   position, the word, ipa, meaning and forms; unmatched words show 没查到.
2. Click 加入月度 — the word is appended to `monthly/YYYY-MM.json` with an
   `example: { sentence, url }`; duplicates are skipped.

## Development

```sh
pnpm dev   # opens a scratch browser with the extension + HMR
```

The dev browser uses a throwaway profile — pick the directory again in its
options page. Requires a Chromium browser (File System Access API); Firefox
is not supported in this mode.
