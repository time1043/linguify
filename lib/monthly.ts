// Pure monthly-file merge logic. No extension or file-system APIs here so it
// runs under plain Node for smoke tests.

export interface MonthlyEntry {
  position: number;
  word: string;
  // Provenance of the word, e.g. "free-nmet/2050.json#970" (bucket file and
  // the entry's position in it); null when the word is not in any bucket.
  from: string | null;
  examples: { sentence: string; url: string }[];
  // Legacy single-example entries written before `examples` existed; they
  // are migrated into `examples` on the next append and dropped.
  example?: { sentence: string; url: string };
}

export interface MonthlyDoc {
  name: string;
  words: MonthlyEntry[];
}

export interface AddWordInput {
  word: string;
  from: string | null;
  example: { sentence: string; url: string };
}

export type AppendReason = 'new' | 'example-appended' | 'exists';

export function monthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// Append one word to a monthly document, creating it on first use. For an
// existing word the example is appended to its `examples` array unless that
// exact example (sentence + url) is already there. Duplicate check is
// case-insensitive on the word itself; position is max(existing) + 1.
// Returns a new document — the caller owns persistence.
export function appendWord(
  doc: MonthlyDoc | null,
  input: AddWordInput,
  today = new Date(),
): { doc: MonthlyDoc; added: boolean; reason: AppendReason; entry?: MonthlyEntry } {
  const base = doc ?? { name: monthKey(today), words: [] };
  const word = input.word.trim();
  const example = {
    sentence: input.example?.sentence ?? '',
    url: input.example?.url ?? '',
  };
  if (!word) return { doc: base, added: false, reason: 'exists' };

  const existing = base.words.find(
    (w) =>
      String(w?.word ?? '')
        .trim()
        .toLowerCase() === word.toLowerCase(),
  );
  if (existing) {
    // Migrate a legacy single `example` into the array form, then append
    // the new example when it has not been recorded yet.
    const prior = Array.isArray(existing.examples)
      ? existing.examples
      : existing.example
        ? [existing.example]
        : [];
    if (prior.some((e) => e.sentence === example.sentence && e.url === example.url)) {
      return { doc: base, added: false, reason: 'exists' };
    }
    existing.examples = [...prior, example];
    delete existing.example;
    return { doc: base, added: true, reason: 'example-appended', entry: existing };
  }

  const position = base.words.reduce((max, w) => Math.max(max, Number(w?.position) || 0), 0) + 1;
  const entry: MonthlyEntry = {
    position,
    word,
    from: input.from,
    examples: [example],
  };
  return { doc: { ...base, words: [...base.words, entry] }, added: true, reason: 'new', entry };
}

export function serializeMonthlyDoc(doc: MonthlyDoc): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}
