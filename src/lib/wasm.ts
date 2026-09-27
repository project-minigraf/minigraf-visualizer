// Load the Minigraf WASM module once (same pattern as minigraf-playground).
import init, { BrowserDb } from "@minigraf/browser";
import wasmUrl from "@minigraf/browser/minigraf_wasm_bg.wasm?url";
import type { MinigrafDb } from "./engine";

let ready: Promise<unknown> | null = null;

export function loadEngine(): Promise<unknown> {
  ready ??= init({ module_or_path: wasmUrl });
  return ready;
}

/** Only call after `loadEngine()` resolved. */
export function openInMemory(): MinigrafDb {
  return BrowserDb.openInMemory();
}
