#!/usr/bin/env node
// Print a visualizer link that opens a Datalog script.
//
//   node scripts/make-link.mjs recipe.dl --title "Retroactive correction" --tx 2 --e :alice --view map
//   echo '(transact [[:a :b 1]])' | node scripts/make-link.mjs - --title "Tiny"
//
// Options: --title, --tx, --vt (now | any | ISO date), --e (entity keyword), --view (graph | map | facts),
// --base (defaults to the deployed app).
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!file) {
  console.error("usage: make-link.mjs <file|-> [--title T] [--tx N] [--vt now|any|DATE] [--e :kw] [--view map]");
  process.exit(1);
}

const script = readFileSync(file === "-" ? 0 : file, "utf8").trim();
const data = Buffer.from(script, "utf8").toString("base64url");
const params = new URLSearchParams();
params.set("data", data);
params.set("title", opt("title") ?? "Linked example");
for (const key of ["tx", "vt", "e", "view"]) if (opt(key)) params.set(key, opt(key));
const base = opt("base") ?? "https://project-minigraf.github.io/minigraf-visualizer/";
console.log(`${base}#${params.toString()}`);
