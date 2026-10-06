// AI analysis sessions: one conversation per sentence, persisted as
// _lib/ai-sessions/<slug>-<key>.json in the vocabulary-bucket directory.
// The session key is derived deterministically from the normalized sentence,
// so re-selecting a previously analyzed sentence finds the same session.

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

export async function loadSession(
  dir: BucketDirHandle,
  fileName: string,
): Promise<SessionDoc | null> {
  try {
    const file = await libDir(dir)
      .then((lib) => lib?.getDirectoryHandle('ai-sessions'))
      .then((sessions) => sessions?.getFileHandle(fileName));
    if (!file) return null;
    const doc = JSON.parse(await (await file.getFile()).text()) as SessionDoc;
    return doc.version === 1 && Array.isArray(doc.messages) ? doc : null;
  } catch {
    // Missing file means this sentence has no session yet.
    return null;
  }
}

export async function saveSession(dir: BucketDirHandle, doc: SessionDoc): Promise<string> {
  const lib = await libDir(dir, true);
  if (!lib) throw new Error('NO_PERMISSION');
  const sessionsDir = await lib.getDirectoryHandle('ai-sessions', { create: true });
  const fileName = await sessionFileName(doc.source.sentence);
  const file = await sessionsDir.getFileHandle(fileName, { create: true });
  const writable = await file.createWritable();
  await writable.write(`${JSON.stringify(doc, null, 2)}\n`);
  await writable.close();
  return `_lib/ai-sessions/${fileName}`;
}

// List every persisted session (newest first), including the full messages
// so the panel can search across conversation content without re-reading
// each file. Malformed files are skipped.
export async function listSessions(
  dir: BucketDirHandle,
): Promise<Array<SessionDoc & { fileName: string }>> {
  const lib = await libDir(dir);
  const sessionsDir = lib ? await lib.getDirectoryHandle('ai-sessions').catch(() => null) : null;
  if (!sessionsDir) return [];

  const sessions: Array<SessionDoc & { fileName: string }> = [];
  for await (const entry of (sessionsDir as IterableDirectoryHandle).values()) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue;
    try {
      const doc = JSON.parse(
        await (await (entry as FileSystemFileHandle).getFile()).text(),
      ) as SessionDoc;
      if (doc.version === 1 && Array.isArray(doc.messages)) {
        sessions.push({ ...doc, fileName: entry.name });
      }
    } catch {
      // Skip malformed session files.
    }
  }
  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
