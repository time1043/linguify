import { useCallback, useEffect, useRef, useState } from 'react';

import type { SessionDoc, SessionMessage } from '@/lib/sessions';

import { aiApiKeyItem } from '@/lib/settings';

interface AiSidebarProps {
  sentence: string;
  url: string;
  onClose: () => void;
}

type Status = 'loading' | 'analyzing' | 'ready' | 'error';

// Relay a message through the background worker to the offscreen document
// (the content script cannot use createWritable() or page-crossing fetches).
async function callOffscreen<T>(message: Record<string, unknown>): Promise<T> {
  const response = (await browser.runtime.sendMessage(message)) as {
    ok?: boolean;
    error?: string;
  } & T;
  if (!response?.ok) throw new Error(response?.error || 'offscreen did not respond');
  return response;
}

function describeAiError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'NO_API_KEY') return '尚未配置 DeepSeek API Key';
  if (message === 'NO_PERMISSION') return '词库目录需要重新授权';
  return message;
}

// In-page right-column chat for AI sentence analysis. One session per
// sentence; previously analyzed sentences resume their saved conversation.
export default function AiSidebar({ sentence, url, onClose }: AiSidebarProps) {
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [status, setStatus] = useState<Status>('loading');
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
        const { text } = await callOffscreen<{ text: string }>({
          type: 'aiChat',
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

  useEffect(() => {
    void (async () => {
      setNoApiKey(!(await aiApiKeyItem.getValue()));
      try {
        const { doc } = await callOffscreen<{ doc: SessionDoc | null }>({
          type: 'loadAiSession',
          sentence,
        });
        if (doc) {
          docRef.current = doc;
          setMessages(doc.messages);
          setStatus('ready');
          setSaveNote(`已加载历史会话（${doc.messages.length} 条消息）`);
          return;
        }
        docRef.current = {
          version: 1,
          key: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          source: { sentence, url },
          messages: [],
        };
        void runTurn(sentence);
      } catch (err) {
        setStatus('error');
        setError(describeAiError(err));
      }
    })();
    // Runs once per opened sentence; the sidebar is keyed by sentence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status]);

  const send = () => {
    const text = input.trim();
    if (!text || status === 'analyzing' || status === 'loading') return;
    setInput('');
    void runTurn(text);
  };

  const busy = status === 'analyzing' || status === 'loading';

  return (
    <div className="fixed top-0 right-0 z-[2147483647] flex h-[100vh] w-[min(380px,100vw)] flex-col border-l border-zinc-200 bg-white font-sans text-sm text-zinc-800 shadow-2xl">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2">
        <h1 className="text-sm font-semibold">AI 句子分析</h1>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="ml-auto text-zinc-400 transition-colors hover:text-zinc-600"
        >
          ✕
        </button>
      </div>

      {noApiKey && (
        <div className="mx-3 mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          尚未配置 DeepSeek API Key，请在插件弹窗的「打开设置」里填写。
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
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
          className="flex-1 resize-none rounded-lg border border-zinc-300 px-2 py-1.5 text-xs outline-none focus:border-violet-500"
        />
        <button
          type="button"
          onClick={send}
          disabled={busy || !input.trim()}
          className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-violet-500 disabled:bg-zinc-200 disabled:text-zinc-400"
        >
          发送
        </button>
      </div>
    </div>
  );
}
