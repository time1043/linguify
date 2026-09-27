// Background service worker: owns the vocabulary cache and all communication
// with the local vocab server. The content script and popup only talk to it
// through runtime messages.

import type { Bucket, LookupResponse, RefreshResponse } from '@/lib/types';

import { serverUrlItem } from '@/lib/storage';
import { buildVocabIndex, lookupWord, type VocabIndex } from '@/lib/vocab';

const VOCAB_TTL_MS = 60_000;

interface VocabCache {
  index: VocabIndex;
  fetchedAt: number;
}

let cache: VocabCache | null = null;

async function fetchVocabIndex(): Promise<VocabIndex> {
  const serverUrl = await serverUrlItem.getValue();
  const res = await fetch(`${serverUrl}/api/vocab`);
  if (!res.ok) throw new Error(`vocab server responded ${res.status}`);
  const data = (await res.json()) as { buckets?: Bucket[] };
  return buildVocabIndex(data.buckets ?? []);
}

// Serve lookups from a short-lived cache so rapid selections do not refetch.
// With allowStale, a failed refresh falls back to the previous snapshot.
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

function errorMessage(err: unknown): string {
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
          return { hit: null, error: errorMessage(err) } satisfies LookupResponse;
        }
      }
      case 'refreshVocab': {
        try {
          const index = await getVocabIndex({ force: true });
          return { ok: true, stats: index.stats } satisfies RefreshResponse;
        } catch (err) {
          return { ok: false, error: errorMessage(err) } satisfies RefreshResponse;
        }
      }
      default:
        return undefined;
    }
  });
});
