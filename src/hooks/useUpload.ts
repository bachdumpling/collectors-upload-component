import { useCallback, useEffect, useRef, useState } from 'react';

export const SIZE_LIMIT = 8 * 1024 * 1024;
export const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

export type Status = 'idle' | 'over' | 'uploading' | 'success' | 'error';

export type Picked = { name: string; size: number; url: string };

/**
 * The zone says the same thing however an upload fails, so the only thing left to carry
 * is whether the recovery re-sends the same file or asks for a different one.
 */
export type UploadError = { retryable: boolean };

type State = {
  status: Status;
  file: Picked | null;
  progress: number;
  error: UploadError | null;
};

const INITIAL: State = { status: 'idle', file: null, progress: 0, error: null };

/** Both failures here need a different file, so neither is retryable. */
function validate(file: File): UploadError | null {
  if (!ACCEPTED.includes(file.type)) return { retryable: false };
  if (file.size > SIZE_LIMIT) return { retryable: false };
  return null;
}

export function useUpload({ forceFailure }: { forceFailure: boolean }) {
  const [state, setState] = useState<State>(INITIAL);

  const raf = useRef(0);
  const objectUrl = useRef<string | null>(null);
  // Retry needs the last accepted file without reading it out of a state updater --
  // updaters must stay pure, and StrictMode runs them twice.
  const lastFile = useRef<Picked | null>(null);
  const failRef = useRef(forceFailure);

  const stop = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = 0;
  }, []);

  const revoke = useCallback(() => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
  }, []);

  useEffect(() => {
    failRef.current = forceFailure;
  }, [forceFailure]);

  useEffect(() => () => {
    stop();
    revoke();
  }, [stop, revoke]);

  const run = useCallback(
    (file: Picked) => {
      stop();
      // Real uploads decelerate as buffers flush, and they never tick evenly.
      // A linear ramp is the single biggest tell that a progress bar is fake.
      const start = performance.now();
      const failAt = failRef.current ? 0.58 + Math.random() * 0.14 : 2;
      let progress = 0;

      setState({ status: 'uploading', file, progress: 0, error: null });
      lastFile.current = file;

      const tick = (now: number) => {
        const dt = Math.min((now - start) / 1000, 60);
        const eased = 1 - Math.pow(1 - Math.min(dt / 2.4, 1), 2.4);
        const jitter = Math.sin(dt * 7.3) * 0.012 + Math.sin(dt * 2.1) * 0.008;
        progress = Math.max(progress, Math.min(1, eased + jitter * (1 - eased)));

        if (progress >= failAt) {
          stop();
          setState(s => ({
            ...s,
            status: 'error',
            progress,
            error: { retryable: true }
          }));
          return;
        }

        setState(s => (s.status === 'uploading' ? { ...s, progress } : s));

        if (progress >= 1) {
          stop();
          setState(s => ({ ...s, status: 'success', progress: 1 }));
          return;
        }
        raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
    },
    [stop]
  );

  const accept = useCallback(
    (files: FileList | File[] | null) => {
      const file = files?.[0];
      if (!file) return;

      const problem = validate(file);
      if (problem) {
        revoke();
        setState({ status: 'error', file: null, progress: 0, error: problem });
        return;
      }

      revoke();
      const url = URL.createObjectURL(file);
      objectUrl.current = url;
      run({ name: file.name, size: file.size, url });
    },
    [revoke, run]
  );

  const retry = useCallback(() => {
    if (lastFile.current) run(lastFile.current);
  }, [run]);

  const reset = useCallback(() => {
    stop();
    revoke();
    lastFile.current = null;
    setState(INITIAL);
  }, [stop, revoke]);

  const setOver = useCallback((over: boolean) => {
    setState(s => {
      if (over && s.status !== 'uploading' && s.status !== 'success') return { ...s, status: 'over', error: null };
      if (!over && s.status === 'over') return { ...s, status: 'idle' };
      return s;
    });
  }, []);

  return { ...state, accept, retry, reset, setOver };
}
