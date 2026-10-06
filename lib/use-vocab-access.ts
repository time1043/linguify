// Shared reactive access state for the settings section, backed by jotai
// atoms. It renders the same directory/permission/stats model the panels use.

import { atom, useAtom } from 'jotai';
import { useCallback, useEffect } from 'react';

import type { RefreshResponse, VocabStats } from '@/lib/types';

import {
  getBucketDir,
  getBucketPermission,
  pickBucketDir,
  requestBucketPermission,
} from '@/lib/fsa';

const dirNameAtom = atom<string | null>(null);
const permissionAtom = atom<PermissionState | null>(null);
const statusAtom = atom<'idle' | 'checking' | 'ok' | 'error'>('idle');
const statsAtom = atom<VocabStats | null>(null);
const errorMessageAtom = atom('');

export function describeError(error?: string): string {
  switch (error) {
    case 'NO_DIR':
      return '尚未选择词库目录';
    case 'NO_PERMISSION':
      return '词库目录需要重新授权';
    default:
      return error || '未知错误';
  }
}

export function useVocabAccess() {
  const [dirName, setDirName] = useAtom(dirNameAtom);
  const [permission, setPermission] = useAtom(permissionAtom);
  const [status, setStatus] = useAtom(statusAtom);
  const [stats, setStats] = useAtom(statsAtom);
  const [errorMessage, setErrorMessage] = useAtom(errorMessageAtom);

  const refreshStats = useCallback(async () => {
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
        setErrorMessage(describeError(response?.error));
      }
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Re-read the persisted handle and its current permission state.
  const reload = useCallback(async () => {
    const dir = await getBucketDir();
    setDirName(dir?.name ?? null);
    setPermission(await getBucketPermission());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Must run in a user gesture (options page).
  const pick = useCallback(async () => {
    await pickBucketDir();
    await reload();
    await refreshStats();
  }, [reload, refreshStats]);

  // Must run in a user gesture (options page).
  const regrant = useCallback(async () => {
    setPermission(await requestBucketPermission());
    await refreshStats();
  }, [refreshStats]);

  return { dirName, permission, status, stats, errorMessage, refreshStats, pick, regrant };
}
