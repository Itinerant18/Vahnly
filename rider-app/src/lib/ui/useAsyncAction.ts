"use client";

import { useCallback, useRef, useState } from "react";
import { useToastStore } from "@/lib/store/useToastStore";
import { friendlyError } from "./errorMessage";

interface Options {
  /** Show an error toast on a thrown error (default true). */
  toastOnError?: boolean;
  /** Extra handler run after a thrown error. */
  onError?: (e: unknown) => void;
}

/**
 * Guards a submit action against double-press: a re-entrant call while one is in flight is
 * ignored (the actual double-tap guard). A thrown error surfaces as an error toast unless
 * toastOnError is false. Wire `disabled={pending}` + `onClick={run}` on the button.
 */
export function useAsyncAction<A extends unknown[]>(
  fn: (...args: A) => Promise<unknown>,
  opts?: Options,
) {
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const run = useCallback(
    async (...args: A) => {
      if (inFlight.current) return; // double-press guard
      inFlight.current = true;
      setPending(true);
      try {
        await fn(...args);
      } catch (e) {
        if (opts?.toastOnError !== false) {
          useToastStore.getState().show(friendlyError(e), "error");
        }
        opts?.onError?.(e);
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
    [fn], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return { run, pending };
}
