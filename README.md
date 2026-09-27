# Vocab Lens

Chrome MV3 extension (WXT + React 19 + TypeScript + Tailwind CSS v4 + Jotai)
that looks up any selected word on a page in a local `vocabulary-bucket`
directory, and saves unknown words to its monthly file.

A browser extension cannot read arbitrary files on disk, so the repo ships a
tiny zero-dependency companion server (`server/index.mjs`) that reads/writes
the bucket directory over HTTP.

## Layout

- `server/index.mjs` — `GET /api/vocab` (all `data/**/*.json`), `POST /api/words`
  (appends to `monthly/YYYY-MM.json`, dedupes by word).
- `entrypoints/background.ts` — service worker: vocab cache (60 s TTL) and all
  server communication.
- `entrypoints/vocab-card.content/` — shadow-root card shown on word selection:
  bucket, word, ipa, meaning, forms (or 没查到); one click adds the word to the
  monthly file together with the enclosing sentence and page URL.
- `entrypoints/popup/` — server URL setting, connection status, vocab stats.
- `lib/vocab.ts` — pure lookup index (headwords + first token of each form).

## Development

```sh
pnpm install

# 1. Start the vocab server (default port 8765).
pnpm vocab

# 2. Start WXT dev mode — a browser opens with the extension loaded, HMR included.
pnpm dev
```

The server defaults to `VOCAB_BUCKET_DIR=C:/Users/28180/Documents/code3/base/web/vocabulary-bucket`;
override it (and `PORT`) via env vars, then update the server URL in the popup.

## Build

```sh
pnpm build   # .output/chrome-mv3 — load unpacked via chrome://extensions
pnpm zip     # distributable zip
```

## Usage

1. Select a word on any page — the card shows the bucket, word, ipa, meaning
   and forms; unmatched words show 没查到.
2. Click 加入月度 — the word is appended to `monthly/YYYY-MM.json` with an
   `example: { sentence, url }`; duplicates are skipped.
3. Use the popup to point the extension at another server or refresh the cache.
