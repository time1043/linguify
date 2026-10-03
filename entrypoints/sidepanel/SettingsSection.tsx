import { useCallback, useEffect, useState } from 'react';

import { AI_MODELS, aiApiKeyItem, aiModelItem, DEFAULT_AI_MODEL } from '@/lib/settings';
import { useVocabAccess } from '@/lib/use-vocab-access';

// Settings for the vocabulary-bucket directory and the DeepSeek API, shown
// at the top of the side panel when toggled.
export default function SettingsSection() {
  const { dirName, permission, status, stats, errorMessage, refreshStats, pick, regrant } =
    useVocabAccess();
  const permissionBadge = permission
    ? { granted: '已授权读写', prompt: '需要重新授权', denied: '已拒绝' }[permission]
    : undefined;
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState<string>(DEFAULT_AI_MODEL);
  const [saved, setSaved] = useState(false);
  // Guards the auto-save: until the stored value has loaded, the local state
  // is still the initial '' — writing it would wipe the saved key.
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      setApiKey(await aiApiKeyItem.getValue());
      setModel(await aiModelItem.getValue());
      setLoaded(true);
    })();
  }, []);

  const save = useCallback(async () => {
    await aiApiKeyItem.setValue(apiKey.trim());
    await aiModelItem.setValue(model);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }, [apiKey, model]);

  // Auto-save while typing (debounced) so a missed button click can never
  // leave the key unsaved.
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => {
      void aiApiKeyItem.setValue(apiKey.trim());
    }, 500);
    return () => clearTimeout(timer);
  }, [apiKey, loaded]);

  return (
    <div className="border-b border-zinc-200 bg-zinc-50 px-3 py-3 text-xs text-zinc-700">
      <div className="flex items-center gap-2">
        <span className="font-medium">词库目录</span>
        {dirName && <span className="font-mono text-[10px] text-zinc-500">📁 {dirName}</span>}
        {permissionBadge && (
          <span
            className={`ml-auto rounded-full px-2 py-0.5 text-[10px] ${
              permission === 'granted'
                ? 'bg-green-100 text-green-700'
                : 'bg-amber-100 text-amber-700'
            }`}
          >
            {permissionBadge}
          </span>
        )}
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => void pick()}
          className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-indigo-500"
        >
          {dirName ? '重新选择目录' : '选择词库文件夹'}
        </button>
        {permission === 'prompt' && (
          <button
            type="button"
            onClick={() => void regrant()}
            className="rounded-lg bg-amber-500 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-amber-400"
          >
            重新授权
          </button>
        )}
        <button
          type="button"
          onClick={() => void refreshStats()}
          className="ml-auto rounded-lg border border-zinc-300 px-2.5 py-1.5 text-[11px] text-zinc-600 transition-colors hover:bg-white"
        >
          刷新
        </button>
      </div>
      <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
        {status === 'ok' && stats
          ? `已连接 · 词桶 ${stats.buckets} · 单词 ${stats.words}`
          : status === 'checking'
            ? '读取中…'
            : status === 'error'
              ? errorMessage
              : '尚未读取'}
        。选择 vocabulary-bucket 根目录（含 data/）；浏览器重启后提示未授权时点「重新授权」。
      </p>

      <div className="mt-3 flex items-center gap-2">
        <span className="font-medium">DeepSeek</span>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="API Key (sk-...)"
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-2 py-1 font-mono text-[11px] outline-none focus:border-indigo-500"
        />
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="rounded-lg border border-zinc-300 px-1 py-1 text-[11px] outline-none focus:border-indigo-500"
        >
          {AI_MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        onClick={() => void save()}
        className="mt-2 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-indigo-500"
      >
        {saved ? '✓ 已保存' : '保存 Key'}
      </button>
      <p className="mt-1.5 font-mono text-[10px] text-zinc-400">扩展实例: {chrome.runtime.id}</p>
    </div>
  );
}
