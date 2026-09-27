import { useCallback, useEffect, useRef, useState } from 'react';

import type { AddWordResponse, LookupHit, LookupResponse } from '@/lib/types';

import { normalizeWord } from '@/lib/vocab';

import Card, { type AddState, type CardStatus, type SelectionContext } from './Card';
import { speakWord, stopSpeaking } from './speech';
import WordPin from './WordPin';

interface State {
  selection: SelectionContext;
  // The card only opens while the pointer rests on the selection pin.
  cardOpen: boolean;
  status: CardStatus;
  hit: LookupHit | null;
  errorText: string;
}

// Map background error codes to actionable card copy.
function describeError(error?: string): string {
  switch (error) {
    case 'NO_DIR':
      return '未选择词库目录，点击插件图标打开设置';
    case 'NO_PERMISSION':
      return '词库目录需要重新授权，点击插件图标打开设置';
    default:
      return '读取词库失败';
  }
}

const SELECTION_DEBOUNCE_MS = 200;
const SENTENCE_MAX_LENGTH = 300;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Extract the sentence around `word` from the enclosing block element.
function extractSentence(element: Element, word: string): string {
  const block = element.closest(
    'p, h1, h2, h3, h4, h5, h6, li, dd, dt, blockquote, pre, figcaption, td, th, div, section, article',
  );
  const text = (block?.textContent ?? element.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const sentences = text.split(/(?<=[.!?。！？])\s+/);
  const pattern = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i');
  const found =
    sentences.find((s) => pattern.test(s)) ??
    sentences.find((s) => s.toLowerCase().includes(word)) ??
    text;
  return found.length > SENTENCE_MAX_LENGTH ? `${found.slice(0, SENTENCE_MAX_LENGTH)}…` : found;
}

// Capture the current single-word selection with its position and context.
function getSelectionContext(): SelectionContext | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const word = normalizeWord(selection.toString());
  if (!word) return null;
  const node = selection.anchorNode;
  const element = node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : node?.parentElement;
  if (
    !element ||
    element.closest('input, textarea, select') ||
    (element as HTMLElement).isContentEditable
  )
    return null;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  return {
    word,
    rect: { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom },
    sentence: extractSentence(element, word),
    url: window.location.href,
  };
}

export default function App() {
  const [state, setState] = useState<State | null>(null);
  const [addState, setAddState] = useState<AddState>('idle');
  const requestId = useRef(0);

  // Runs when the pin is activated — the selection alone never triggers
  // network work or speech.
  const runLookup = useCallback(async (selection: SelectionContext) => {
    const id = ++requestId.current;
    setState({ selection, cardOpen: true, status: 'pending', hit: null, errorText: '' });
    setAddState('idle');
    try {
      const response = (await browser.runtime.sendMessage({
        type: 'lookup',
        word: selection.word,
      })) as LookupResponse;
      if (id !== requestId.current) return; // a newer activation superseded this one
      if (response?.error)
        setState({
          selection,
          cardOpen: true,
          status: 'error',
          hit: null,
          errorText: describeError(response.error),
        });
      else
        setState({
          selection,
          cardOpen: true,
          status: response?.hit ? 'found' : 'missing',
          hit: response?.hit ?? null,
          errorText: '',
        });
    } catch {
      if (id === requestId.current)
        setState({
          selection,
          cardOpen: true,
          status: 'error',
          hit: null,
          errorText: '扩展通信失败',
        });
    }
  }, []);

  const openCard = useCallback(() => {
    if (!state) return;
    // Speak only when opening; re-entering an open pin stays silent.
    if (!state.cardOpen) speakWord(state.selection.word);
    void runLookup(state.selection);
  }, [state, runLookup]);

  const closeCard = useCallback(() => {
    setState((prev) => (prev ? { ...prev, cardOpen: false } : prev));
  }, []);

  const addWord = useCallback(async () => {
    if (!state || addState === 'adding') return;
    setAddState('adding');
    try {
      const response = (await browser.runtime.sendMessage({
        type: 'addWord',
        word: state.selection.word,
        example: { sentence: state.selection.sentence, url: state.selection.url },
      })) as AddWordResponse;
      if (response?.error) setAddState('error');
      else setAddState(response?.added ? 'added' : 'exists');
    } catch {
      setAddState('error');
    }
  }, [state, addState]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Hiding everything also stops any ongoing pronunciation.
    const dismiss = () => {
      setState(null);
      stopSpeaking();
    };
    const onSelectionChange = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const selection = getSelectionContext();
        // A new selection only shows the pin; lookup and speech wait for hover.
        if (selection)
          setState({ selection, cardOpen: false, status: 'pending', hit: null, errorText: '' });
        else dismiss();
      }, SELECTION_DEBOUNCE_MS);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    const onScroll = () => dismiss();

    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      clearTimeout(timer);
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, []);

  return state ? (
    <WordPin
      selection={state.selection}
      active={state.cardOpen}
      onActivate={openCard}
      onDeactivate={closeCard}
    >
      <Card
        selection={state.selection}
        status={state.status}
        hit={state.hit}
        errorText={state.errorText}
        addState={addState}
        onAdd={() => void addWord()}
        onSpeak={() => speakWord(state.selection.word)}
      />
    </WordPin>
  ) : null;
}
