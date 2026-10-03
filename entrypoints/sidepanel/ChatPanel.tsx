import { useCallback, useEffect, useRef, useState } from 'react';

import type { SessionDoc, SessionMessage } from '@/lib/sessions';

import { callOffscreen } from '@/lib/relay';
import { aiApiKeyItem, aiPendingSessionItem, type PendingAiSession } from '@/lib/settings';

type Status = 'empty' | 'loading' | 'analyzing' | 'ready' | 'error';

const PENDING_MAX_AGE_MS = 10 * 60_000;

function describeAiError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'NO_API_KEY') return '尚未配置 DeepSeek API Key';
  if (message === 'NO_PERMISSION') return '词库目录需要重新授权';
  return message;
}

// Tab 1: the AI conversation. One session per sentence; a previously
// analyzed sentence resumes its saved conversation. New sentences arrive via
// the pending-session storage item (set by the content script's violet pin).
export default function ChatPanel({ onPending }: { onPending?: () => void }) {
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [status, setStatus] = useState<Status>('empty');
  const [error, setError] = useState('');
  const [saveNote, setSaveNote] = useState('');
  const [noApiKey, setNoApiKey] = useState(false);
  const [input, setInput] = useState('');
  const docRef = useRef<SessionDoc | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const persist = useCallback(async (doc: SessionDoc) => {
    try {
      const { file } = await callOffscreen<{ file: string }>({ type: 'saveAiSession', doc });
      setSaveNote(`已保存 ${file}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'NO_DIR') setSaveNote('未连接词库目录，会话未保存');
      else if (message === 'NO_PERMISSION') setSaveNote('词库目录需要重新授权，会话未保存');
      else setSaveNote(`会话保存失败：${message}`);
    }
  }, []);

  // Shared tail of every turn: call the AI over the given history, append
  // the reply (or keep the dangling user message on failure), persist.
  const completeTurn = useCallback(
    async (doc: SessionDoc, history: SessionMessage[]) => {
      setMessages(history);
      setStatus('analyzing');
      setError('');
      let failed = false;
      try {
        // 'aiChatRequest' is handled ONLY by the background worker (which
        // injects the API key/model and relays an 'aiChat' message to the
        // offscreen document) — broadcasting 'aiChat' itself would let the
        // offscreen answer without the key.
        const { text } = await callOffscreen<{ text: string }>({
          type: 'aiChatRequest',
          messages: history,
        });
        doc.messages = [...history, { role: 'assistant', content: text }];
      } catch (err) {
        failed = true;
        doc.messages = history; // keep the user message even on failure
        setStatus('error');
        setError(describeAiError(err));
      } finally {
        doc.updatedAt = new Date().toISOString();
        setMessages(doc.messages);
        if (!failed) setStatus('ready');
        void persist(doc);
      }
    },
    [persist],
  );

  const runTurn = useCallback(
    async (userContent: string) => {
      const doc = docRef.current;
      if (!doc) return;
      await completeTurn(doc, [...doc.messages, { role: 'user', content: userContent }]);
    },
    [completeTurn],
  );

  const startSession = useCallback(
    async (pending: PendingAiSession) => {
      setStatus('loading');
      setError('');
      setSaveNote('');
      try {
        const dir = await callOffscreen<{ doc: SessionDoc | null }>({
          type: 'loadAiSession',
          sentence: pending.sentence,
        });
        if (dir.doc) {
          docRef.current = dir.doc;
          setMessages(dir.doc.messages);
          const last = dir.doc.messages.at(-1);
          if (!last || last.role === 'user') {
            // A turn was left unanswered (e.g. the earlier attempt failed) —
            // finish it now instead of showing a dead conversation.
            const history = dir.doc.messages.length
              ? dir.doc.messages
              : [{ role: 'user' as const, content: pending.sentence }];
            await completeTurn(dir.doc, history);
          } else {
            setStatus('ready');
            setSaveNote(`已加载历史会话（${dir.doc.messages.length} 条消息）`);
          }
          return;
        }
        docRef.current = {
          version: 1,
          key: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          source: { sentence: pending.sentence, url: pending.url },
          messages: [],
        };
        setMessages([]);
        await runTurn(pending.sentence);
      } catch (err) {
        setStatus('error');
        setError(describeAiError(err));
      }
    },
    [completeTurn, runTurn],
  );

  useEffect(() => {
    void (async () => {
      setNoApiKey(!(await aiApiKeyItem.getValue()));
      const pending = await aiPendingSessionItem.getValue();
      if (pending && Date.now() - pending.ts < PENDING_MAX_AGE_MS) {
        onPending?.();
        void startSession(pending);
      }
    })();
    // New sentence selections arrive while the panel is already open.
    // The API-key banner clears live as soon as a key is saved in settings.
    return aiPendingSessionItem.watch((pending) => {
      if (pending && Date.now() - pending.ts < PENDING_MAX_AGE_MS) {
        onPending?.();
        void startSession(pending);
      }
    });
  }, []);

  useEffect(
    () =>
      aiApiKeyItem.watch((key) => {
        setNoApiKey(!key);
      }),
    [],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status]);

  const send = () => {
    const text = input.trim();
    if (!text || status === 'analyzing' || status === 'loading') return;
    if (!docRef.current) {
      // Panel opened without a selection: the question itself starts a session.
      docRef.current = {
        version: 1,
        key: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        source: { sentence: text, url: '' },
        messages: [],
      };
    }
    setInput('');
    void runTurn(text);
  };

  const busy = status === 'analyzing' || status === 'loading';

  return (
    <div className="flex h-full flex-col">
      {noApiKey && (
        <div className="mx-3 mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          尚未配置 DeepSeek API Key，请点上方「设置」。
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {status === 'empty' && (
          <p className="mt-6 text-center text-xs leading-relaxed text-zinc-400">
            在网页上选中一个句子（不是一个单词），
            <br />
            点击紫色小圆点即可开始分析。
          </p>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-indigo-600 px-3 py-2 text-xs leading-relaxed text-white">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <div className="max-w-[90%] rounded-2xl rounded-bl-md bg-zinc-100 px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap text-zinc-800">
                {m.content}
              </div>
            </div>
          ),
        )}
        {status === 'analyzing' && <p className="text-xs text-zinc-400">分析中…</p>}
        {status === 'error' && <p className="text-xs text-red-600">{error}</p>}
        <div ref={bottomRef} />
      </div>

      {saveNote && <p className="px-3 pb-1 text-[10px] text-zinc-400">{saveNote}</p>}

      <div className="flex items-end gap-2 border-t border-zinc-200 p-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="追问…
Enter 发送，Shift+Enter 换行"
          rows={2}
          className="flex-1 resize-none rounded-lg border border-zinc-300 px-2 py-1.5 text-xs outline-none focus:border-indigo-500"
        />
        <button
          type="button"
          onClick={send}
          disabled={busy || !input.trim()}
          className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:bg-zinc-200 disabled:text-zinc-400"
        >
          发送
        </button>
      </div>
    </div>
  );
}
