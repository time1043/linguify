import { useVocabAccess } from '@/lib/use-vocab-access';

const STATUS_DOT: Record<string, string> = {
  ok: 'bg-green-500',
  error: 'bg-red-500',
  checking: 'bg-amber-400',
  idle: 'bg-zinc-300',
};

export default function App() {
  const { dirName, permission, status, stats, errorMessage } = useVocabAccess();

  return (
    <div className="flex flex-col gap-3 p-4 font-sans text-sm text-zinc-800">
      <div className="flex items-center gap-2">
        <h1 className="text-base font-semibold">Vocab Lens</h1>
        <span className={`ml-auto h-2.5 w-2.5 rounded-full ${STATUS_DOT[status]}`} />
      </div>

      <div className="rounded-lg bg-zinc-50 p-2 text-xs">
        {dirName ? (
          <p className="text-zinc-700">
            📁 {dirName}
            {permission === 'prompt' && <span className="ml-1 text-amber-600">需要重新授权</span>}
          </p>
        ) : (
          <p className="text-zinc-500">尚未选择词库目录</p>
        )}
        {status === 'ok' && stats && (
          <p className="mt-1 text-zinc-600">
            词桶 {stats.buckets} · 单词 {stats.words}
          </p>
        )}
        {status === 'checking' && <p className="mt-1 text-zinc-400">检测中…</p>}
        {status === 'error' && <p className="mt-1 text-red-600">{errorMessage}</p>}
      </div>

      <button
        type="button"
        onClick={() => void browser.runtime.openOptionsPage()}
        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500"
      >
        打开设置
      </button>

      <p className="text-xs leading-relaxed text-zinc-500">
        在网页上选中一个单词，悬停其左上角的小圆点即可查询词库；无论是否查到，都可以点卡片上的「加入月度」把它写进
        monthly/ 当月文件。
      </p>
    </div>
  );
}
