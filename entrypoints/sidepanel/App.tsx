import { useCallback, useEffect, useRef, useState } from 'react';

import { aiComplete } from '@/lib/ai';
import { getBucketDir } from '@/lib/fsa';
import {
  loadSession,
  saveSession,
  sessionFileName,
  type SessionDoc,
  type SessionMessage,
} from '@/lib/sessions';
import { aiApiKeyItem, aiPendingSessionItem, type PendingAiSession } from '@/lib/settings';

type Status = 'empty' | 'loading' | 'analyzing' | 'ready' | 'error';

function describeAiError(err: unknown): string {
  if (err instanceof Error && err.message === 'NO_API_KEY') return '尚未配置 DeepSeek API Key';
  return err instanceof Error ? err.message : String(err);
}

export default function App() {
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
      const dir = await getBucketDir();
      if (!dir) {
        setSaveNote('未连接词库目录，本次会话不会保存');
        return;
      }
      const file = await saveSession(dir, doc);
      setSaveNote(`已保存 ${file}`);
    } catch {
      setSaveNote('会话保存失败（词库目录可能需要重新授权）');
    }
  }, []);

  // Run one turn: append the user message, get the AI reply, persist the doc.
  const runTurn = useCallback(
    async (userContent: string) => {
      const doc = docRef.current;
      if (!doc) return;
      const history: SessionMessage[] = [...doc.messages, { role: 'user', content: userContent }];
      setMessages(history);
      setStatus('analyzing');
      setError('');
      let failed = false;
      try {
        const reply = await aiComplete(history);
        doc.messages = [...history, { role: 'assistant', content: reply }];
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

  // Load the pending sentence from the content script. A previously analyzed
  // sentence restores its session; a new one starts a fresh conversation.
  const startSession = useCallback(
    async (pending: PendingAiSession) => {
      setStatus('loading');
      setError('');
      setSaveNote('');
      try {
        const fileName = await sessionFileName(pending.sentence);
        const dir = await getBucketDir();
        const existing = dir ? await loadSession(dir, fileName) : null;
        if (existing) {
          docRef.current = existing;
          setMessages(existing.messages);
          setStatus('ready');
          setSaveNote(`已加载历史会话（${existing.messages.length} 条消息）`);
          return;
        }
        docRef.current = {
          version: 1,
          key: fileName,
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
    [runTurn],
  );

  useEffect(() => {
    void (async () => {
      setNoApiKey(!(await aiApiKeyItem.getValue()));
      const pending = await aiPendingSessionItem.getValue();
      if (pending) void startSession(pending);
    })();
    // React to new sentence selections while the panel is already open.
    return aiPendingSessionItem.watch((pending) => {
      if (pending) void startSession(pending);
    });
  }, [startSession]);

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
        key: 'adhoc',
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
    <div className="flex h-full flex-col bg-white font-sans text-sm text-zinc-800">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2">
        <h1 className="text-sm font-semibold">AI 句子分析</h1>
        <button
          type="button"
          onClick={() => void browser.runtime.openOptionsPage()}
          className="ml-auto text-xs text-zinc-400 transition-colors hover:text-indigo-600"
        >
          设置
        </button>
      </div>

      {noApiKey && (
        <div className="mx-3 mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          尚未配置 DeepSeek API Key，请先到设置页填写。
          <button
            type="button"
            onClick={() => void browser.runtime.openOptionsPage()}
            className="ml-1 font-medium underline"
          >
            去配置
          </button>
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {status === 'empty' && (
          <p className="mt-6 text-center text-xs leading-relaxed text-zinc-400">
            在网页上选中一个句子（不是一个单词），
            <br />
            悬停紫色小圆点即可开始分析。
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
              <div className="max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-bl-md bg-zinc-100 px-3 py-2 text-xs leading-relaxed text-zinc-800">
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
