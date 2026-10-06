// Shared vocabulary-bucket directory state for the panel tabs that read or
// write files in it. Module-level jotai atoms: all panels see the same
// permission state, so granting in one tab instantly clears the other tabs'
// banners, and switching tabs never re-runs the check.

import { atom, useAtom } from 'jotai';
import { useCallback, useEffect } from 'react';

import { getBucketDir, pickBucketDir, requestBucketPermission } from '@/lib/fsa';

export type DirState = 'none' | 'prompt' | 'ok' | null;

const dirStateAtom = atom<DirState>(null);
// Bumped by pick/regrant so consumers' load effects re-run.
const dirTickAtom = atom(0);

export function useBucketDir() {
  const [dirState, setDirState] = useAtom(dirStateAtom);
  const [tick, setTick] = useAtom(dirTickAtom);

  useEffect(() => {
    void (async () => {
      const dir = await getBucketDir().catch(() => null);
      if (!dir) {
        setDirState('none');
        return;
      }
      setDirState((await dir.queryPermission({ mode: 'read' })) === 'granted' ? 'ok' : 'prompt');
    })();
  }, [tick, setDirState]);

  const pick = useCallback(async () => {
    await pickBucketDir();
    setDirState('ok');
    setTick((value) => value + 1);
  }, [setDirState, setTick]);

  const regrant = useCallback(async () => {
    await requestBucketPermission();
    setDirState('ok');
    setTick((value) => value + 1);
  }, [setDirState, setTick]);

  return { dirState, pick, regrant, tick };
}
