#!/usr/bin/env node
// Local companion server for the Vocab Lens extension.
//
// A browser extension cannot read arbitrary files on disk, so this tiny
// zero-dependency server exposes the vocabulary-bucket directory over HTTP:
//   GET  /health      -> liveness + stats
//   GET  /api/vocab   -> all bucket files merged (data/**/*.json)
//   POST /api/words   -> append one word to monthly/YYYY-MM.json
//
// Env:
//   VOCAB_BUCKET_DIR  root of the vocabulary-bucket repo
//   PORT              port to listen on (default 8765; avoid Windows
//                     Hyper-V reserved ranges, e.g. 7681-7780)

import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const ROOT =
  process.env.VOCAB_BUCKET_DIR ?? 'C:/Users/28180/Documents/code3/base/web/vocabulary-bucket';
const DATA_DIR = path.join(ROOT, 'data');
const MONTHLY_DIR = path.join(ROOT, 'monthly');
const PORT = Number(process.env.PORT ?? 8765);
const MAX_BODY_BYTES = 1024 * 1024;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// Read every bucket file under data/ (recursively). Unreadable files are
// skipped with a warning so one bad file cannot take the API down.
async function readBuckets() {
  const files = (await readdir(DATA_DIR, { recursive: true }))
    .filter((f) => f.endsWith('.json'))
    .sort();
  const buckets = [];
  for (const rel of files) {
    try {
      const doc = JSON.parse(await readFile(path.join(DATA_DIR, rel), 'utf8'));
      if (Array.isArray(doc?.words))
        buckets.push({ name: String(doc.name ?? rel), words: doc.words });
      else console.warn(`skip bucket without "words" array: ${rel}`);
    } catch (err) {
      console.warn(`skip unreadable bucket ${rel}: ${err.message}`);
    }
  }
  return buckets;
}

// Append one word to the monthly file, creating it on first use.
// Duplicate check is case-insensitive on the word itself.
async function addWord(input) {
  const word = typeof input?.word === 'string' ? input.word.trim() : '';
  if (!word) throw new HttpError(400, '"word" is required');

  const ym = monthKey();
  const file = path.join(MONTHLY_DIR, `${ym}.json`);
  await mkdir(MONTHLY_DIR, { recursive: true });

  let doc;
  if (existsSync(file)) {
    doc = JSON.parse(await readFile(file, 'utf8'));
    if (!Array.isArray(doc?.words)) throw new HttpError(500, `malformed monthly file: ${file}`);
  } else {
    doc = { name: ym, words: [] };
  }

  const key = (w) =>
    String(w?.word ?? '')
      .trim()
      .toLowerCase();
  if (doc.words.some((w) => key(w) === word.toLowerCase())) {
    return { added: false, reason: 'exists', file };
  }

  const position = doc.words.reduce((max, w) => Math.max(max, Number(w?.position) || 0), 0) + 1;
  const entry = {
    position,
    word,
    ipa: typeof input.ipa === 'string' ? input.ipa : '',
    meaning: typeof input.meaning === 'string' ? input.meaning : '',
    forms: Array.isArray(input.forms) ? input.forms : [],
    example: {
      sentence: typeof input?.example?.sentence === 'string' ? input.example.sentence : '',
      url: typeof input?.example?.url === 'string' ? input.example.url : '',
    },
  };
  doc.words.push(entry);
  await writeFile(file, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  return { added: true, file, entry };
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'body too large');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid JSON body');
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

const server = createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const { pathname } = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  try {
    if (req.method === 'GET' && pathname === '/health') {
      const buckets = await readBuckets();
      sendJson(res, 200, {
        ok: true,
        dir: ROOT,
        buckets: buckets.length,
        words: buckets.reduce((sum, b) => sum + b.words.length, 0),
      });
    } else if (req.method === 'GET' && pathname === '/api/vocab') {
      sendJson(res, 200, { generatedAt: new Date().toISOString(), buckets: await readBuckets() });
    } else if (req.method === 'POST' && pathname === '/api/words') {
      sendJson(res, 200, await addWord(await readJsonBody(req)));
    } else {
      throw new HttpError(404, `no route: ${req.method} ${pathname}`);
    }
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error(err);
    sendJson(res, status, { error: err.message ?? 'internal error' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Vocab server listening on http://localhost:${PORT}`);
  console.log(`Bucket dir: ${ROOT}`);
});
