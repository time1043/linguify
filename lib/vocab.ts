// Pure vocabulary lookup helpers. No extension APIs are used here so the
// module can also run under plain Node for smoke tests.

import type { Bucket, LookupHit } from './types';

export interface VocabIndex {
  byWord: Map<string, LookupHit>;
  stats: { buckets: number; words: number };
}

// Reduce a free-form selection to a single lookup token, e.g. '"Changed,"' ->
// 'changed'. Returns null when the selection contains no word-like token.
export function normalizeWord(input: string): string | null {
  const token = input.toLowerCase().match(/[a-z][a-z'’-]*/)?.[0];
  const cleaned = token?.replace(/^[-'’]+|[-'’]+$/g, '');
  return cleaned ? cleaned : null;
}

// Build a flat lookup map covering every headword and every form. Forms look
// like "changed v." — the lookup key is the first token. When the same key
// appears in several buckets the first bucket wins.
export function buildVocabIndex(buckets: Bucket[]): VocabIndex {
  const byWord = new Map<string, LookupHit>();
  let words = 0;
  for (const bucket of buckets) {
    for (const entry of bucket.words) {
      words += 1;
      const hit: LookupHit = { bucket: bucket.name, entry };
      const key = entry.word.trim().toLowerCase();
      if (key && !byWord.has(key)) byWord.set(key, hit);
      for (const form of entry.forms ?? []) {
        const formKey = normalizeWord(form);
        if (formKey && !byWord.has(formKey)) byWord.set(formKey, hit);
      }
    }
  }
  return { byWord, stats: { buckets: buckets.length, words } };
}

export function lookupWord(index: VocabIndex, word: string): LookupHit | null {
  const normalized = normalizeWord(word);
  return normalized ? (index.byWord.get(normalized) ?? null) : null;
}
