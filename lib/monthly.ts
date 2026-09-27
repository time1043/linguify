// Pure monthly-file merge logic. No extension or file-system APIs here so it
// runs under plain Node for smoke tests.

import type { WordEntry } from './types';

export interface MonthlyDoc {
  name: string;
  words: WordEntry[];
}

export interface AddWordInput {
  word: string;
  ipa?: string;
  meaning?: string;
  forms?: string[];
  example: { sentence: string; url: string };
}

export function monthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// Append one word to a monthly document, creating it on first use. Duplicate
// check is case-insensitive on the word itself; position is max(existing)+1.
// Returns a new document — the caller owns persistence.
export function appendWord(
  doc: MonthlyDoc | null,
  input: AddWordInput,
  today = new Date(),
): { doc: MonthlyDoc; added: boolean; entry?: WordEntry } {
  const base = doc ?? { name: monthKey(today), words: [] };
  const word = input.word.trim();
  const exists = base.words.some(
    (w) =>
      String(w?.word ?? '')
        .trim()
        .toLowerCase() === word.toLowerCase(),
  );
  if (exists || !word) return { doc: base, added: false };

  const position = base.words.reduce((max, w) => Math.max(max, Number(w?.position) || 0), 0) + 1;
  const entry: WordEntry = {
    position,
    word,
    ipa: input.ipa ?? '',
    meaning: input.meaning ?? '',
    forms: input.forms ?? [],
    example: {
      sentence: input.example?.sentence ?? '',
      url: input.example?.url ?? '',
    },
  };
  return { doc: { ...base, words: [...base.words, entry] }, added: true, entry };
}

export function serializeMonthlyDoc(doc: MonthlyDoc): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}
