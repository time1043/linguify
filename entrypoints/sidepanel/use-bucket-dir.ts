// Shared vocabulary-bucket directory state for the panel tabs that read or
// write files in it: whether a directory is picked, whether its permission
// still holds, and the pick/regrant gestures (which bump a tick so consumers
// can re-run their load logic).

import { useCallback, useEffect, useState } from 'react';

import { getBucketDir, pickBucketDir, requestBucketPermission } from '@/lib/fsa';

export type DirState = 'none' | 'prompt' | 'ok' | null;

export function useBucketDir() {
  const [dirState, setDirState] = useState<DirState>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    void (async () => {
      const dir = await getBucketDir().catch(() => null);
      if (!dir) {
        setDirState('none');
        return;
      }
      setDirState((await dir.queryPermission({ mode: 'read' })) === 'granted' ? 'ok' : 'prompt');
    })();
  }, [tick]);

  const pick = useCallback(async () => {
    await pickBucketDir();
    setDirState('ok');
    setTick((value) => value + 1);
  }, []);

  const regrant = useCallback(async () => {
    await requestBucketPermission();
    setDirState('ok');
    setTick((value) => value + 1);
  }, []);

  return { dirState, pick, regrant, tick };
}
