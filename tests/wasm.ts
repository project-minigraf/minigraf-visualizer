// Load the real @minigraf/browser WASM engine in Node. The in-memory database
// never touches IndexedDB, so it runs fine outside a browser.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { BrowserDb, initSync } from "@minigraf/browser";
import type { MinigrafDb } from "../src/lib/engine";

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve("@minigraf/browser/package.json"));

let ready = false;

export function openMemory(): MinigrafDb {
  if (!ready) {
    initSync({ module: readFileSync(join(pkgDir, "minigraf_wasm_bg.wasm")) });
    ready = true;
  }
  return BrowserDb.openInMemory();
}
