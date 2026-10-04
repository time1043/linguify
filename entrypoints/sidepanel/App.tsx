import { useState } from 'react';

import ChatPanel from './ChatPanel';
import SettingsSection from './SettingsSection';
import VocabPanel from './VocabPanel';

type Tab = 'chat' | 'vocab';

export default function App() {
  const [tab, setTab] = useState<Tab>('chat');
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="flex h-full flex-col bg-white font-sans text-sm text-zinc-800">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2">
        <h1 className="text-sm font-semibold">Linguify</h1>
        <button
          type="button"
          onClick={() => setSettingsOpen((open) => !open)}
          className={`ml-auto rounded-lg px-2.5 py-1 text-xs transition-colors ${
            settingsOpen
              ? 'bg-zinc-200 text-zinc-700'
              : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700'
          }`}
        >
          设置
        </button>
      </div>

      {settingsOpen && <SettingsSection />}

      <div className="flex border-b border-zinc-200 text-xs">
        {(
          [
            ['chat', '句子对话'],
            ['vocab', '生词本'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex-1 py-2 font-medium transition-colors ${
              tab === id
                ? 'border-b-2 border-indigo-600 text-indigo-600'
                : 'text-zinc-500 hover:text-zinc-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'chat' ? <ChatPanel onPending={() => setTab('chat')} /> : <VocabPanel />}
      </div>
    </div>
  );
}
