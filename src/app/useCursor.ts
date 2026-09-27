import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ValidAt } from "../lib/datalog";

export interface CursorState {
  asOf: number;
  validAt: ValidAt;
  playing: boolean;
  setAsOf(n: number): void;
  setValidAt(v: ValidAt): void;
  setBoth(asOf: number, validAt: ValidAt): void;
  step(delta: number): void;
  togglePlay(): void;
}

const PLAY_INTERVAL_MS = 1100;

/** Time cursor over transaction time (0..maxTx) and valid time, with playback. */
export function useCursor(maxTx: number, revision: number): CursorState {
  const [asOf, setAsOfRaw] = useState(maxTx);
  const [validAt, setValidAt] = useState<ValidAt>({ kind: "now" });
  const [playing, setPlaying] = useState(false);
  const maxRef = useRef(maxTx);
  maxRef.current = maxTx;

  // Jump to the newest transaction whenever the data changes.
  useEffect(() => {
    setAsOfRaw(maxRef.current);
    setPlaying(false);
  }, [revision]);

  const clamp = (n: number) => Math.max(0, Math.min(maxRef.current, Math.round(n)));
  const setAsOf = useCallback((n: number) => setAsOfRaw(clamp(n)), []);
  const step = useCallback((delta: number) => {
    setPlaying(false);
    setAsOfRaw((a) => clamp(a + delta));
  }, []);
  const setBoth = useCallback((n: number, v: ValidAt) => {
    setAsOfRaw(clamp(n));
    setValidAt(v);
  }, []);

  const togglePlay = useCallback(() => {
    setPlaying((p) => {
      if (!p) setAsOfRaw((a) => (a >= maxRef.current ? 0 : a));
      return !p;
    });
  }, []);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setAsOfRaw((a) => {
        if (a >= maxRef.current) {
          setPlaying(false);
          return a;
        }
        return a + 1;
      });
    }, PLAY_INTERVAL_MS);
    return () => clearInterval(id);
  }, [playing]);

  return useMemo(
    () => ({ asOf, validAt, playing, setAsOf, setValidAt, setBoth, step, togglePlay }),
    [asOf, validAt, playing, setAsOf, setBoth, step, togglePlay],
  );
}

/**
 * Current wall-clock time, refreshed every 30 seconds and whenever the data
 * changes. A fact written without `:valid-from` is valid from its transaction
 * time, so "now" must never lag behind the newest write.
 */
export function useNow(revision: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => setNow(Date.now()), [revision]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}
