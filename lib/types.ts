// Shared domain types: vocabulary buckets, lookup hits, and the messages
// exchanged between the content script / popup and the background worker.

// An entry inside a dictionary bucket file (data/**/*.json).
export interface WordEntry {
  position: number;
  word: string;
  ipa: string;
  meaning: string;
  forms: string[];
}

// A dictionary file (bucket) inside the vocabulary-bucket data directory.
export interface Bucket {
  // Source file path relative to the data directory, e.g. "free-nmet/2050.json".
  path: string;
  name: string;
  words: WordEntry[];
}

export interface LookupHit {
  bucket: Bucket;
  entry: WordEntry;
}

export interface VocabStats {
  buckets: number;
  words: number;
}

// Messages sent from the content script / popup to the background worker.
export interface LookupMessage {
  type: 'lookup';
  word: string;
}

export interface LookupResponse {
  hit: LookupHit | null;
  error?: string;
}

export interface RefreshVocabMessage {
  type: 'refreshVocab';
}

export interface RefreshResponse {
  ok: boolean;
  stats?: VocabStats;
  error?: string;
}

// The sentence/url context is captured by the content script; the provenance
// (`from`) is resolved by the background worker when the word is known.
export interface AddWordMessage {
  type: 'addWord';
  word: string;
  example: {
    sentence: string;
    url: string;
  };
}

export interface AddWordResponse {
  ok: boolean;
  added?: boolean;
  reason?: string;
  error?: string;
}
