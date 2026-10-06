// Shared vocabulary-bucket directory state for the panel tabs that read or
// write files in it. Module-level jotai atoms: all panels see the same
// permission state, so granting in one tab instantly clears the other tabs'
// banners, and switching tabs never re-runs the check.

import { atom, useAtom } from 'jotai';
import { useCallback, useEffect } from 'react';

import {
  bucketDirAccessible,
  getBucketDir,
  pickBucketDir,
  requestBucketPermission,
} from '@/lib/fsa';

export type DirState = 'none' | 'prompt' | 'ok' | null;

const dirStateAtom = atom<DirState>(null);
// Bumped by pick/regrant so consumers' load effects re-run.
const dirTickAtom = atom(0);

// requestPermission opens a native dialog; concurrent callers (the first
// gesture anywhere plus an explicit button click in the same gesture) must
// collapse into one request or two dialogs would stack.
let regrantInFlight: Promise<void> | null = null;
// After the user denies the restore dialog, stop auto-requesting on further
// gestures for this panel session — the explicit buttons keep working.
let autoRegrantBlocked = false;

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
      // Probed with a real read, not queryPermission() — see
      // bucketDirAccessible: the query lies 'prompt' on freshly restored
      // documents whose origin-level grant is still alive.
      setDirState((await bucketDirAccessible(dir)) ? 'ok' : 'prompt');
    })();
  }, [tick, setDirState]);

  const pick = useCallback(async () => {
    await pickBucketDir();
    setDirState('ok');
    setTick((value) => value + 1);
  }, [setDirState, setTick]);

  const regrant = useCallback(async () => {
    if (regrantInFlight) return regrantInFlight;
    regrantInFlight = (async () => {
      try {
        // Only a granted state may flip the banner away; 'denied' keeps the
        // banner up (the panels' own reads would fail with NO_PERMISSION).
        if ((await requestBucketPermission()) === 'granted') {
          setDirState('ok');
          setTick((value) => value + 1);
        } else {
          setDirState('prompt');
          autoRegrantBlocked = true;
        }
      } finally {
        regrantInFlight = null;
      }
    })();
    return regrantInFlight;
  }, [setDirState, setTick]);

  // Panels discover mid-session permission loss on their own loads (probe or
  // NotAllowedError); they report it here so the banner and the auto-restore
  // below re-arm no matter which tab noticed.
  const reportPrompt = useCallback((): void => {
    setDirState('prompt');
  }, [setDirState]);

  // The directory grant does not outlive the panel document, so restoring it
  // needs a user gesture — but instead of making the user hunt for the
  // re-authorize button, try gesture-less first (requestPermission resolves
  // silently when the browser still considers the grant alive, and merely
  // rejects without a dialog otherwise), then re-request from the first
  // click anywhere in the panel.
  useEffect(() => {
    if (dirState !== 'prompt' || autoRegrantBlocked) return;
    void regrant().catch(() => undefined);
    const onGesture = (): void => {
      void regrant().catch(() => undefined);
    };
    window.addEventListener('pointerdown', onGesture, { capture: true, once: true });
    return () => window.removeEventListener('pointerdown', onGesture, { capture: true });
  }, [dirState, regrant]);

  return { dirState, pick, regrant, reportPrompt, tick };
}
