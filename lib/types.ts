// Shared domain types: vocabulary buckets, lookup hits, and the messages
// exchanged between the content script / popup and the background worker.

export interface WordEntry {
  position: number;
  word: string;
  ipa: string;
  meaning: string;
  forms: string[];
}

export interface Bucket {
  name: string;
  words: WordEntry[];
}

export interface LookupHit {
  bucket: string;
  entry: WordEntry;
}

export interface VocabStats {
  buckets: number;
  words: number;
}
