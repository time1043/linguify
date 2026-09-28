// Offscreen document: a windowed context for the things the MV3 service
// worker cannot do — createWritable() file writes and dynamic-import based
// SDK loading (pi-ai). The directory handle is read from the shared
// IndexedDB; it is never passed across contexts.

import type { AddWordResponse } from '@/lib/types';

import { aiComplete, type AiMessage } from '@/lib/ai';
import { VocabAccessError, appendMonthly, getBucketDir, listMonthly, readMonthly } from '@/lib/fsa';
import { loadSession, saveSession, sessionFileName, type SessionDoc } from '@/lib/sessions';

interface WriteMonthlyMessage {
  type: 'writeMonthly';
  word: string;
  from: string | null;
  example: { sentence: string; url: string };
}

interface AiChatMessage {
  type: 'aiChat';
  messages: AiMessage[];
  // The offscreen document has no chrome.storage API — the background
  // worker reads the settings and passes them in.
  apiKey: string;
  model: string;
}

interface LoadAiSessionMessage {
  type: 'loadAiSession';
  sentence: string;
}

interface SaveAiSessionMessage {
  type: 'saveAiSession';
  doc: SessionDoc;
}

interface ListMonthlyMessage {
  type: 'listMonthly';
}

interface ReadMonthlyMessage {
  type: 'readMonthly';
  month: string;
}

type OffscreenMessage =
  | WriteMonthlyMessage
  | AiChatMessage
  | LoadAiSessionMessage
  | SaveAiSessionMessage
  | ListMonthlyMessage
  | ReadMonthlyMessage;

function errorCode(err: unknown): string {
  if (err instanceof VocabAccessError) return err.code;
  if (err instanceof DOMException && err.name === 'NotAllowedError') return 'NO_PERMISSION';
  return err instanceof Error ? err.message : String(err);
}

async function handle(msg: OffscreenMessage): Promise<unknown> {
  switch (msg.type) {
    case 'writeMonthly': {
      const dir = await getBucketDir();
      if (!dir) throw new VocabAccessError('NO_DIR');
      const result = await appendMonthly(dir, {
        word: msg.word,
        from: msg.from,
        example: msg.example,
      });
      return {
        ok: true,
        added: result.added,
        reason: result.added ? undefined : 'exists',
      } satisfies AddWordResponse;
    }
    case 'aiChat': {
      return {
        ok: true,
        text: await aiComplete(msg.messages, { apiKey: msg.apiKey, model: msg.model }),
      };
    }
    case 'loadAiSession': {
      // A missing directory just means the session cannot be restored yet;
      // the chat itself must keep working.
      const dir = await getBucketDir();
      if (!dir) return { ok: true, doc: null };
      const doc = await loadSession(dir, await sessionFileName(msg.sentence));
      return { ok: true, doc };
    }
    case 'saveAiSession': {
      const dir = await getBucketDir();
      if (!dir) throw new VocabAccessError('NO_DIR');
      return { ok: true, file: await saveSession(dir, msg.doc) };
    }
    case 'listMonthly': {
      const dir = await getBucketDir();
      if (!dir) throw new VocabAccessError('NO_DIR');
      return { ok: true, months: await listMonthly(dir) };
    }
    case 'readMonthly': {
      const dir = await getBucketDir();
      if (!dir) throw new VocabAccessError('NO_DIR');
      return { ok: true, doc: await readMonthly(dir, msg.month) };
    }
  }
}

browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const msg = message as OffscreenMessage | undefined;
  if (
    !msg ||
    ![
      'writeMonthly',
      'aiChat',
      'loadAiSession',
      'saveAiSession',
      'listMonthly',
      'readMonthly',
    ].includes(msg.type)
  ) {
    return false;
  }

  void handle(msg)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: errorCode(err) }));

  // Keep the message channel open for the async response.
  return true;
});
