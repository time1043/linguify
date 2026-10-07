// AI analysis sessions: one conversation per sentence, persisted as
// _lib/run/ai-sessions/<slug>-<key>.json in the mounted data directory.
// (Renamed from _lib/ai-sessions — the legacy directory is still read, and
// writes always go to the new location.) The session key is derived
// deterministically from the normalized sentence, so re-selecting a
// previously analyzed sentence finds the same session.

import type { BucketDirHandle, IterableDirectoryHandle } from './fsa';

import { libDir } from './fsa';

export interface SessionSource {
  sentence: string;
  url: string;
}

export interface SessionMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface SessionDoc {
  version: 1;
  // Identity hash of the normalized sentence.
  key: string;
  createdAt: string;
  updatedAt: string;
  source: SessionSource;
  messages: SessionMessage[];
}

const KEY_LENGTH = 12;
const SLUG_MAX_LENGTH = 28;

// Collapse whitespace and lowercase so trivial differences (extra spaces,
// casing) still map to the same session.
function normalizeSentence(sentence: string): string {
  return sentence.replace(/\s+/g, ' ').trim().toLowerCase();
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function slugify(sentence: string): string {
  const slug = normalizeSentence(sentence)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, '');
  return slug || 'session';
}

export async function sessionFileName(sentence: string): Promise<string> {
  const key = (await sha256Hex(normalizeSentence(sentence))).slice(0, KEY_LENGTH);
  return `${slugify(sentence)}-${key}.json`;
}

// The current sessions location _lib/run/ai-sessions — created on demand for
// writes, null when absent for reads.
async function sessionsDir(
  lib: FileSystemDirectoryHandle,
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  if (create) {
    const run = await lib.getDirectoryHandle('run', { create: true });
    return run.getDirectoryHandle('ai-sessions', { create: true });
  }
  return lib
    .getDirectoryHandle('run')
    .then((run) => run.getDirectoryHandle('ai-sessions'))
    .catch(() => null);
}

// The pre-rename location _lib/ai-sessions, still read for old checkouts.
async function legacySessionsDir(
  lib: FileSystemDirectoryHandle,
): Promise<FileSystemDirectoryHandle | null> {
  return lib.getDirectoryHandle('ai-sessions').catch(() => null);
}

export async function loadSession(
  dir: BucketDirHandle,
  fileName: string,
): Promise<SessionDoc | null> {
  const lib = await libDir(dir);
  if (!lib) return null;
  for (const sessions of [await sessionsDir(lib, false), await legacySessionsDir(lib)]) {
    if (!sessions) continue;
    try {
      const file = await sessions.getFileHandle(fileName);
      const doc = JSON.parse(await (await file.getFile()).text()) as SessionDoc;
      if (doc.version === 1 && Array.isArray(doc.messages)) return doc;
    } catch {
      // Try the next location.
    }
  }
  // Missing file means this sentence has no session yet.
  return null;
}

export async function saveSession(dir: BucketDirHandle, doc: SessionDoc): Promise<string> {
  const lib = await libDir(dir, true);
  if (!lib) throw new Error('NO_PERMISSION');
  const sessions = await sessionsDir(lib, true);
  if (!sessions) throw new Error('NO_PERMISSION');
  const fileName = await sessionFileName(doc.source.sentence);
  const file = await sessions.getFileHandle(fileName, { create: true });
  const writable = await file.createWritable();
  await writable.write(`${JSON.stringify(doc, null, 2)}\n`);
  await writable.close();
  return `_lib/run/ai-sessions/${fileName}`;
}

// List every persisted session (newest first), including the full messages
// so the panel can search across conversation content without re-reading
// each file. Both the current and the legacy location are read (the current
// one wins on a file name present in both); malformed files are skipped.
export async function listSessions(
  dir: BucketDirHandle,
): Promise<Array<SessionDoc & { fileName: string }>> {
  const lib = await libDir(dir);
  if (!lib) return [];
  const sessionDirs = [await sessionsDir(lib, false), await legacySessionsDir(lib)];
  const byFile = new Map<string, SessionDoc & { fileName: string }>();
  for (const sessionsDir of sessionDirs) {
    if (!sessionsDir) continue;
    for await (const entry of (sessionsDir as IterableDirectoryHandle).values()) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue;
      if (byFile.has(entry.name)) continue;
      try {
        const doc = JSON.parse(
          await (await (entry as FileSystemFileHandle).getFile()).text(),
        ) as SessionDoc;
        if (doc.version === 1 && Array.isArray(doc.messages)) {
          byFile.set(entry.name, { ...doc, fileName: entry.name });
        }
      } catch {
        // Skip malformed session files.
      }
    }
  }
  return [...byFile.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
