// Offscreen document: the MV3 service worker has no createWritable(), so
// monthly-file writes run here in a windowed context. The directory handle is
// read from the shared IndexedDB — it is never passed across contexts.

import type { AddWordResponse } from '@/lib/types';

import { VocabAccessError, appendMonthly, getBucketDir } from '@/lib/fsa';

interface WriteMonthlyMessage {
  type: 'writeMonthly';
  word: string;
  from: string | null;
  example: { sentence: string; url: string };
}

function errorCode(err: unknown): string {
  if (err instanceof VocabAccessError) return err.code;
  if (err instanceof DOMException && err.name === 'NotAllowedError') return 'NO_PERMISSION';
  return err instanceof Error ? err.message : String(err);
}

browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const msg = message as WriteMonthlyMessage | undefined;
  if (msg?.type !== 'writeMonthly') return false;

  void (async (): Promise<AddWordResponse> => {
    try {
      const dir = await getBucketDir();
      if (!dir) throw new VocabAccessError('NO_DIR');
      const result = await appendMonthly(dir, {
        word: msg.word,
        from: msg.from,
        example: msg.example,
      });
      return { ok: true, added: result.added, reason: result.added ? undefined : 'exists' };
    } catch (err) {
      return { ok: false, error: errorCode(err) };
    }
  })().then(sendResponse);

  // Keep the message channel open for the async response.
  return true;
});
