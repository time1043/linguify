// Background service worker: owns the vocabulary cache and all access to the
// user's vocabulary-bucket directory (via the File System Access API). The
// content script and popup only talk to it through runtime messages.

import type { AddWordResponse, LookupResponse, RefreshResponse } from '@/lib/types';

import { VocabAccessError, appendMonthly, getBucketDir, readBuckets } from '@/lib/fsa';
import { buildVocabIndex, lookupWord, normalizeWord, type VocabIndex } from '@/lib/vocab';

const VOCAB_TTL_MS = 60_000;

interface VocabCache {
  index: VocabIndex;
  fetchedAt: number;
}

let cache: VocabCache | null = null;

async function fetchVocabIndex(): Promise<VocabIndex> {
  const dir = await getBucketDir();
  if (!dir) throw new VocabAccessError('NO_DIR');
  try {
    return buildVocabIndex(await readBuckets(dir));
  } catch (err) {
    // File access without a granted permission throws NotAllowedError.
    if (err instanceof VocabAccessError) throw err;
    if (err instanceof DOMException && err.name === 'NotAllowedError')
      throw new VocabAccessError('NO_PERMISSION');
    throw err;
  }
}

// Serve lookups from a short-lived cache so rapid selections do not re-read
// files. With allowStale, a failed refresh falls back to the previous snapshot.
async function getVocabIndex(
  options: { force?: boolean; allowStale?: boolean } = {},
): Promise<VocabIndex> {
  const { force = false, allowStale = false } = options;
  if (!force && cache && Date.now() - cache.fetchedAt < VOCAB_TTL_MS) return cache.index;
  try {
    const index = await fetchVocabIndex();
    cache = { index, fetchedAt: Date.now() };
    return index;
  } catch (err) {
    if (allowStale && cache) return cache.index;
    throw err;
  }
}

function errorCode(err: unknown): string {
  if (err instanceof VocabAccessError) return err.code;
  if (err instanceof DOMException && err.name === 'NotAllowedError') return 'NO_PERMISSION';
  return err instanceof Error ? err.message : String(err);
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(async (message: unknown): Promise<unknown> => {
    const { type } = (message ?? {}) as { type?: string };
    switch (type) {
      case 'lookup': {
        try {
          const { word } = message as { word: string };
          const index = await getVocabIndex({ allowStale: true });
          return { hit: lookupWord(index, word) } satisfies LookupResponse;
        } catch (err) {
          return { hit: null, error: errorCode(err) } satisfies LookupResponse;
        }
      }
      case 'refreshVocab': {
        try {
          const index = await getVocabIndex({ force: true });
          return { ok: true, stats: index.stats } satisfies RefreshResponse;
        } catch (err) {
          return { ok: false, error: errorCode(err) } satisfies RefreshResponse;
        }
      }
      case 'addWord': {
        try {
          const { word, example } = message as {
            word: string;
            example: { sentence: string; url: string };
          };
          // Record where the word was found, e.g. "free-nmet/2050.json#970".
          // Provenance is best-effort; the write works without it too.
          let from: string | null = null;
          try {
            const hit = lookupWord(await getVocabIndex({ allowStale: true }), word);
            if (hit) from = `${hit.bucket.path}#${hit.entry.position}`;
          } catch {
            // Provenance is best-effort.
          }
          const dir = await getBucketDir();
          if (!dir) throw new VocabAccessError('NO_DIR');
          const result = await appendMonthly(dir, {
            word: normalizeWord(word) ?? word,
            from,
            example,
          });
          return {
            ok: true,
            added: result.added,
            reason: result.added ? undefined : 'exists',
          } satisfies AddWordResponse;
        } catch (err) {
          return { ok: false, error: errorCode(err) } satisfies AddWordResponse;
        }
      }
      default:
        return undefined;
    }
  });
});
