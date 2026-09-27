import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect } from 'react';

import type { RefreshResponse } from '@/lib/types';

import { DEFAULT_SERVER_URL, serverUrlItem } from '@/lib/storage';

import { errorMessageAtom, loadServerUrl, serverUrlAtom, statsAtom, statusAtom } from './atoms';

const STATUS_DOT: Record<string, string> = {
  ok: 'bg-green-500',
  error: 'bg-red-500',
  checking: 'bg-amber-400',
  idle: 'bg-zinc-300',
};

export default function App() {
  const [serverUrl, setServerUrl] = useAtom(serverUrlAtom);
  const status = useAtomValue(statusAtom);
  const stats = useAtomValue(statsAtom);
  const [errorMessage, setErrorMessage] = useAtom(errorMessageAtom);
  const setStatus = useSetAtom(statusAtom);
  const setStats = useSetAtom(statsAtom);

  useEffect(() => {
    void loadServerUrl(setServerUrl);
  }, []);

  const refresh = async () => {
    setStatus('checking');
    setErrorMessage('');
    try {
      const response = (await browser.runtime.sendMessage({
        type: 'refreshVocab',
      })) as RefreshResponse;
      if (response?.ok && response.stats) {
        setStats(response.stats);
        setStatus('ok');
      } else {
        setStatus('error');
        setErrorMessage(response?.error ?? 'unknown error');
      }
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const save = async () => {
    await serverUrlItem.setValue(serverUrl.trim() || DEFAULT_SERVER_URL);
    await refresh();
  };

  return (
    <div className="flex flex-col gap-3 p-4 font-sans text-sm text-zinc-800">
      <div className="flex items-center gap-2">
        <h1 className="text-base font-semibold">Vocab Lens</h1>
        <span className={`ml-auto h-2.5 w-2.5 rounded-full ${STATUS_DOT[status]}`} />
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-zinc-500">词库服务地址</span>
        <input
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
          placeholder={DEFAULT_SERVER_URL}
          className="rounded-lg border border-zinc-300 px-2 py-1.5 font-mono text-xs outline-none focus:border-indigo-500"
        />
      </label>

      <button
        type="button"
        onClick={() => void save()}
        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500"
      >
        保存并检测
      </button>

      <div className="rounded-lg bg-zinc-50 p-2 text-xs text-zinc-600">
        {status === 'ok' && stats
          ? `已连接 · 词桶 ${stats.buckets} · 单词 ${stats.words}`
          : status === 'checking'
            ? '检测中…'
            : status === 'error'
              ? `连接失败：${errorMessage}`
              : '尚未检测连接'}
      </div>

      <p className="text-xs leading-relaxed text-zinc-500">
        在网页上选中一个单词即可查询词库；无论是否查到，都可以点卡片上的「加入月度」把它存进
        vocabulary-bucket 的 monthly 当月文件。
      </p>
    </div>
  );
}
