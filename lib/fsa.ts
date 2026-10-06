// File System Access API layer. The user picks the vocabulary-bucket
// directory once in the options page; the handle is kept in IndexedDB so the
// background service worker can read buckets and write the monthly file.

import { get, set } from 'idb-keyval';

import type { Bucket } from './types';

import {
  appendWord,
  monthKey,
  serializeMonthlyDoc,
  type AddWordInput,
  type MonthlyDoc,
} from './monthly';

const BUCKET_DIR_KEY = 'bucketDirHandle';

// Chrome-specific permission methods are not in the default DOM typings.
export type BucketDirHandle = FileSystemDirectoryHandle & {
  queryPermission(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
};

// Directory async iteration helpers are also missing from the DOM typings.
export type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
};

// Thrown to UI surfaces with a stable code the card can map to copy.
export class VocabAccessError extends Error {
  constructor(readonly code: 'NO_DIR' | 'NO_PERMISSION') {
    super(code);
  }
}

function isNotAllowed(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'NotAllowedError';
}

// Must be called from a visible page (popup / options) — it needs a user gesture.
export async function pickBucketDir(): Promise<BucketDirHandle> {
  const picker = (
    window as unknown as {
      showDirectoryPicker?: (options?: {
        mode?: 'read' | 'readwrite';
      }) => Promise<FileSystemDirectoryHandle>;
    }
  ).showDirectoryPicker;
  if (!picker) throw new Error('此浏览器不支持文件系统访问，需要 Chrome');
  const handle = (await picker.call(window, { mode: 'readwrite' })) as BucketDirHandle;
  await set(BUCKET_DIR_KEY, handle);
  return handle;
}

export async function getBucketDir(): Promise<BucketDirHandle | null> {
  const handle = (await get(BUCKET_DIR_KEY)) as BucketDirHandle | undefined;
  return handle ?? null;
}

export async function getBucketPermission(): Promise<PermissionState | null> {
  const dir = await getBucketDir();
  if (!dir) return null;
  return (await bucketDirAccessible(dir)) ? 'granted' : 'prompt';
}

// Needs a user gesture — call from the options page.
export async function requestBucketPermission(): Promise<PermissionState> {
  const dir = await getBucketDir();
  if (!dir) throw new VocabAccessError('NO_DIR');
  return dir.requestPermission({ mode: 'readwrite' });
}

// queryPermission() on a freshly restored panel document reports 'prompt'
// even while the origin-level grant is still alive (the service worker keeps
// reading the same directory fine), which used to force a pointless
// re-authorize every time the panel reopened or a new video appeared. Only a
// real directory access tells the truth: NotFoundError and repo-shape errors
// still prove the handle is usable, and NotAllowedError is the one state
// that genuinely needs regranting.
export async function bucketDirAccessible(dir: BucketDirHandle): Promise<boolean> {
  try {
    await dir.getDirectoryHandle('_lib');
    return true;
  } catch (err) {
    return !(err instanceof DOMException && err.name === 'NotAllowedError');
  }
}

// User-generated data (subtitles, monthly vocab, AI sessions) lives in _lib/
// — renamed from user/ so it sorts away from data/ — and this resolves it.
// Reads fall back to the old name so pre-rename repos keep working; with
// create the _lib directory is made (null only if the FS refuses).
export async function libDir(
  dir: BucketDirHandle,
  create = false,
): Promise<FileSystemDirectoryHandle | null> {
  const lib = await dir.getDirectoryHandle('_lib', { create }).catch(() => null);
  if (lib || create) return lib;
  return dir.getDirectoryHandle('user').catch(() => null);
}

async function* jsonFiles(
  dir: FileSystemDirectoryHandle,
  prefix = '',
): AsyncGenerator<{ handle: FileSystemFileHandle; path: string }> {
  for await (const entry of (dir as IterableDirectoryHandle).values()) {
    if (entry.kind === 'directory') {
      // User-generated data and repo noise are never vocab buckets.
      if (['_lib', 'user', 'monthly', 'node_modules', '.git'].includes(entry.name)) continue;
      yield* jsonFiles(entry as FileSystemDirectoryHandle, `${prefix}${entry.name}/`);
    } else if (entry.name.endsWith('.json')) {
      yield { handle: entry as FileSystemFileHandle, path: `${prefix}${entry.name}` };
    }
  }
}

// Read every bucket file. Prefers the data/ subdirectory when present (the
// recommended pick is the vocabulary-bucket repo root), otherwise scans the
// chosen directory itself.
export async function readBuckets(dir: BucketDirHandle): Promise<Bucket[]> {
  const dataDir = await dir.getDirectoryHandle('data').catch(() => null);
  const root = dataDir ?? dir;
  const buckets: Bucket[] = [];
  for await (const { handle, path } of jsonFiles(root)) {
    try {
      const doc = JSON.parse(await (await handle.getFile()).text());
      if (Array.isArray(doc?.words))
        buckets.push({ path, name: String(doc.name ?? path), words: doc.words });
    } catch (err) {
      console.warn(`skip unreadable bucket ${path}:`, err);
    }
  }
  return buckets.sort((a, b) => a.name.localeCompare(b.name));
}

// Append one word to _lib/vocab-monthly/YYYY-MM.json. The _lib/ directory
// holds user-generated data, mirroring data/ for dictionary data.
export async function appendMonthly(
  dir: BucketDirHandle,
  input: AddWordInput,
  today = new Date(),
): Promise<{ added: boolean; file: string }> {
  const ym = monthKey(today);
  const lib = await libDir(dir, true);
  if (!lib) throw new VocabAccessError('NO_PERMISSION');
  const monthlyDir = await lib.getDirectoryHandle('vocab-monthly', { create: true });
  const file = await monthlyDir.getFileHandle(`${ym}.json`, { create: true });

  let doc: MonthlyDoc | null = null;
  try {
    doc = JSON.parse(await (await file.getFile()).text()) as MonthlyDoc;
  } catch {
    // First write — start a fresh document.
  }
  const result = appendWord(doc, input, today);
  if (result.added) {
    const writable = await file.createWritable();
    await writable.write(serializeMonthlyDoc(result.doc));
    await writable.close();
  }
  return { added: result.added, file: `_lib/vocab-monthly/${ym}.json` };
}

// List the recorded monthly files (newest first) with their word counts.
export async function listMonthly(
  dir: BucketDirHandle,
): Promise<{ name: string; count: number }[]> {
  const lib = await libDir(dir);
  const monthlyDir = lib ? await lib.getDirectoryHandle('vocab-monthly').catch(() => null) : null;
  if (!monthlyDir) return [];
  const months: { name: string; count: number }[] = [];
  for await (const entry of (monthlyDir as IterableDirectoryHandle).values()) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue;
    try {
      const parsed = JSON.parse(
        await (await (entry as FileSystemFileHandle).getFile()).text(),
      ) as MonthlyDoc;
      if (Array.isArray(parsed?.words)) {
        months.push({
          name: String(parsed.name ?? entry.name.replace(/\.json$/, '')),
          count: parsed.words.length,
        });
      }
    } catch {
      // Skip malformed month files.
    }
  }
  return months.sort((a, b) => b.name.localeCompare(a.name));
}

// Read one monthly document by month key (e.g. "2026-09"); null when the
// file does not exist yet.
export async function readMonthly(dir: BucketDirHandle, month: string): Promise<MonthlyDoc | null> {
  const lib = await libDir(dir);
  const monthlyDir = lib ? await lib.getDirectoryHandle('vocab-monthly').catch(() => null) : null;
  if (!monthlyDir) return null;
  try {
    const file = await monthlyDir.getFileHandle(`${month}.json`);
    return JSON.parse(await (await file.getFile()).text()) as MonthlyDoc;
  } catch {
    return null;
  }
}
