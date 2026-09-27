// Background service worker: owns the vocabulary cache and all communication
// with the local vocab server. The content script and popup only talk to it
// through runtime messages.

import type { AddWordResponse, Bucket, LookupResponse, RefreshResponse } from '@/lib/types';

import { serverUrlItem } from '@/lib/storage';
import { buildVocabIndex, lookupWord, normalizeWord, type VocabIndex } from '@/lib/vocab';

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
      case 'addWord': {
        try {
          const { word, example } = message as {
            word: string;
            example: { sentence: string; url: string };
          };
          // Enrich the entry from the buckets when the word is known.
          const index = await getVocabIndex({ allowStale: true });
          const hit = lookupWord(index, word);
          const serverUrl = await serverUrlItem.getValue();
          const res = await fetch(`${serverUrl}/api/words`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              word: normalizeWord(word) ?? word,
              ipa: hit?.entry.ipa ?? '',
              meaning: hit?.entry.meaning ?? '',
              forms: hit?.entry.forms ?? [],
              example,
            }),
          });
          const data = (await res.json().catch(() => ({}))) as {
            added?: boolean;
            reason?: string;
            error?: string;
          };
          if (!res.ok)
            return {
              ok: false,
              error: data.error ?? `vocab server responded ${res.status}`,
            } satisfies AddWordResponse;
          return { ok: true, added: data.added, reason: data.reason } satisfies AddWordResponse;
        } catch {
          return {
            ok: false,
            error: '无法连接词库服务，请先启动 vocab server',
          } satisfies AddWordResponse;
        }
      }
      default:
        return undefined;
    }
  });
});
