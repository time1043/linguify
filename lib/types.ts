// Shared domain types: vocabulary buckets, lookup hits, and the messages
// exchanged between the content script / popup and the background worker.

export interface WordEntry {
  position: number;
  word: string;
  ipa: string;
  meaning: string;
  forms: string[];
  // Only present on monthly entries; bucket files never carry it.
  example?: { sentence: string; url: string };
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

// The sentence/url context is captured by the content script; the vocab
// fields are filled in by the background worker when the word is known.
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
