import { useCallback, useEffect, useState } from 'react';

import { AI_MODELS, aiApiKeyItem, aiModelItem, DEFAULT_AI_MODEL } from '@/lib/settings';
import { useVocabAccess } from '@/lib/use-vocab-access';

const PERMISSION_LABEL: Record<string, { text: string; className: string }> = {
  granted: { text: '已授权读写', className: 'bg-green-100 text-green-700' },
  prompt: { text: '需要重新授权', className: 'bg-amber-100 text-amber-700' },
  denied: { text: '已拒绝，请重新选择目录', className: 'bg-red-100 text-red-700' },
};

function AiSettings() {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState<string>(DEFAULT_AI_MODEL);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      setApiKey(await aiApiKeyItem.getValue());
      setModel(await aiModelItem.getValue());
    })();
  }, []);

  const save = useCallback(async () => {
    await aiApiKeyItem.setValue(apiKey.trim());
    await aiModelItem.setValue(model);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }, [apiKey, model]);

  return (
    <section className="mt-4 rounded-xl border border-zinc-200 bg-white p-4">
      <h2 className="font-medium">AI 设置</h2>
      <label className="mt-2 flex flex-col gap-1">
        <span className="text-xs text-zinc-500">DeepSeek API Key</span>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-..."
          className="rounded-lg border border-zinc-300 px-2 py-1.5 font-mono text-xs outline-none focus:border-indigo-500"
        />
      </label>
      <label className="mt-2 flex flex-col gap-1">
        <span className="text-xs text-zinc-500">模型</span>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="rounded-lg border border-zinc-300 px-2 py-1.5 text-xs outline-none focus:border-indigo-500"
        >
          {AI_MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={() => void save()}
        className="mt-3 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500"
      >
        {saved ? '✓ 已保存' : '保存'}
      </button>
    </section>
  );
}

export default function App() {
  const { dirName, permission, status, stats, errorMessage, refreshStats, pick, regrant } =
    useVocabAccess();
  const permissionBadge = permission ? PERMISSION_LABEL[permission] : undefined;

  return (
    <div className="mx-auto max-w-xl p-6 font-sans text-sm text-zinc-800">
      <h1 className="text-lg font-semibold">Vocab Lens 设置</h1>

      <section className="mt-4 rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="font-medium">词库目录</h2>
        <div className="mt-2 flex items-center gap-2">
          {dirName ? (
            <>
              <span className="font-mono text-xs">📁 {dirName}</span>
              {permissionBadge && (
                <span className={`rounded-full px-2 py-0.5 text-xs ${permissionBadge.className}`}>
                  {permissionBadge.text}
                </span>
              )}
            </>
          ) : (
            <span className="text-zinc-500">尚未选择目录</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void pick()}
          className="mt-3 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500"
        >
          {dirName ? '重新选择目录' : '选择词库文件夹'}
        </button>
        {permission === 'prompt' && (
          <button
            type="button"
            onClick={() => void regrant()}
            className="ml-2 mt-3 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-400"
          >
            重新授权
          </button>
        )}
        <p className="mt-2 text-xs leading-relaxed text-zinc-500">
          选择 vocabulary-bucket 仓库根目录（包含 data/ 文件夹）；用户生成数据会写入
          user/vocab-monthly/。
          浏览器重启后如果查询提示未授权，回到这里点一下「重新授权」即可；若授权弹窗提供
          「每次访问时允许」，选它就一劳永逸。
        </p>
      </section>

      <section className="mt-4 rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="font-medium">词库状态</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refreshStats()}
            className="ml-auto rounded-lg border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 transition-colors hover:bg-zinc-50"
          >
            重新读取
          </button>
        </div>
        <div className="mt-2 text-xs">
          {status === 'ok' && stats && (
            <p className="text-zinc-600">
              已连接 · 词桶 {stats.buckets} · 单词 {stats.words}
            </p>
          )}
          {status === 'checking' && <p className="text-zinc-400">读取中…</p>}
          {status === 'error' && <p className="text-red-600">{errorMessage}</p>}
          {status === 'idle' && <p className="text-zinc-400">尚未读取</p>}
        </div>
      </section>

      <AiSettings />

      <section className="mt-4 rounded-xl border border-zinc-200 bg-white p-4 text-xs leading-relaxed text-zinc-500">
        <h2 className="text-sm font-medium text-zinc-800">使用方式</h2>
        <p className="mt-2">
          1.
          在任意网页选中一个单词，其左上角会出现一个小圆点；鼠标移上去会朗读单词并显示词本、位置、音标、释义和变形。
        </p>
        <p className="mt-1">
          2. 点卡片上的「加入月度」，单词连同例句、网址和出处（如 free-nmet/2050.json#970）会被写入
          user/vocab-monthly/YYYY-MM.json；重复添加会自动跳过。
        </p>
        <p className="mt-1">
          3. 选中的不是一个单词（比如整句）时，悬停紫色小圆点会打开 AI
          侧边栏分析句子成分，可以继续追问；每个句子一个会话，保存在
          user/ai-sessions/，再次选中同一句子会续上之前的会话。
        </p>
      </section>
    </div>
  );
}
