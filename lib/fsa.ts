// File System Access API layer. The user picks the vocabulary-bucket
// directory once in the options page; the handle is kept in IndexedDB so the
// background service worker can read buckets and write the monthly file.

import { get, set } from 'idb-keyval';
import { appendWord, monthKey, serializeMonthlyDoc, type MonthlyDoc } from './monthly';
import type { AddWordInput, Bucket } from './types';

const BUCKET_DIR_KEY = 'bucketDirHandle';

// Chrome-specific permission methods are not in the default DOM typings.
type BucketDirHandle = FileSystemDirectoryHandle & {
  queryPermission(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
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
  const picker = (window as unknown as {
    showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  }).showDirectoryPicker;
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
  return dir ? dir.queryPermission({ mode: 'readwrite' }) : null;
}

// Needs a user gesture — call from the options page.
export async function requestBucketPermission(): Promise<PermissionState> {
  const dir = await getBucketDir();
  if (!dir) throw new VocabAccessError('NO_DIR');
  return dir.requestPermission({ mode: 'readwrite' });
}

async function* jsonFiles(
  dir: FileSystemDirectoryHandle,
  prefix = '',
): AsyncGenerator<{ handle: FileSystemFileHandle; path: string }> {
  for await (const entry of dir.values()) {
    if (entry.kind === 'directory') {
      // Monthly outputs and repo noise are never vocab buckets.
      if (['monthly', 'node_modules', '.git'].includes(entry.name)) continue;
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
      if (Array.isArray(doc?.words)) buckets.push({ name: String(doc.name ?? path), words: doc.words });
    } catch (err) {
      console.warn(`skip unreadable bucket ${path}:`, err);
    }
  }
  return buckets.sort((a, b) => a.name.localeCompare(b.name));
}

// Append one word to monthly/YYYY-MM.json next to the bucket data.
export async function appendMonthly(
  dir: BucketDirHandle,
  input: AddWordInput,
  today = new Date(),
): Promise<{ added: boolean; file: string }> {
  const ym = monthKey(today);
  const monthly = await dir.getDirectoryHandle('monthly', { create: true });
  const file = await monthly.getFileHandle(`${ym}.json`, { create: true });

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
  return { added: result.added, file: `monthly/${ym}.json` };
}
