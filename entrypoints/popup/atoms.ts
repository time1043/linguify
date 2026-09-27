// Popup state atoms. The server URL is mirrored into chrome.storage so the
// background worker reads the same value on every request.

import { atom } from 'jotai';

import type { VocabStats } from '@/lib/types';

import { DEFAULT_SERVER_URL, serverUrlItem } from '@/lib/storage';

export const serverUrlAtom = atom(DEFAULT_SERVER_URL);
export const statusAtom = atom<'idle' | 'checking' | 'ok' | 'error'>('idle');
export const statsAtom = atom<VocabStats | null>(null);
export const errorMessageAtom = atom('');

// Keep the atom in sync with the persisted value on first open.
export async function loadServerUrl(set: (url: string) => void): Promise<void> {
  set(await serverUrlItem.getValue());
}
