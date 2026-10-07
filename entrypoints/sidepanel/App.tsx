import { useCallback, useState } from 'react';

import { aiPendingSessionItem } from '@/lib/settings';

import SelectionPin from '../../components/selection-pin/SelectionPin';
import ChatPanel from './ChatPanel';
import NotesPanel from './NotesPanel';
import SettingsSection from './SettingsSection';
import SubtitlesPanel from './SubtitlesPanel';
import VocabPanel from './VocabPanel';

type Tab = 'chat' | 'vocab' | 'subs' | 'notes';

export default function App() {
  const [tab, setTab] = useState<Tab>('chat');
  const [settingsOpen, setSettingsOpen] = useState(false);

  // The violet pin inside the panel hands the sentence straight to the chat
  // tab through the same pending-session storage item the content script
  // uses; the chat tab's storage watcher picks it up and starts the session.
  const onSentenceForAI = useCallback(async (sentence: string, url: string): Promise<boolean> => {
    await aiPendingSessionItem.setValue({ sentence, url, ts: Date.now() });
    setTab('chat');
    return true;
  }, []);

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
            ['subs', '字幕'],
            ['notes', '记笔记'],
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

      {/* All tabs stay mounted (inactive ones hidden) so directory
          permission state, drafts and scroll positions survive tab switches. */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className={tab === 'chat' ? 'h-full' : 'hidden'}>
          <ChatPanel onPending={() => setTab('chat')} />
        </div>
        <div className={tab === 'vocab' ? 'h-full' : 'hidden'}>
          <VocabPanel />
        </div>
        <div className={tab === 'subs' ? 'h-full' : 'hidden'}>
          <SubtitlesPanel active={tab === 'subs'} />
        </div>
        <div className={tab === 'notes' ? 'h-full' : 'hidden'}>
          <NotesPanel active={tab === 'notes'} />
        </div>
      </div>

      {/* Selection pins for panel-internal text (AI replies, notes, subtitle
          lines): the violet pin starts a chat session, the word pin looks the
          word up in the buckets. */}
      <SelectionPin selectionUrl="" onSentenceForAI={onSentenceForAI} />
    </div>
  );
}
