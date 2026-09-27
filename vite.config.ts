/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative asset paths, so the build works from any sub-path (GitHub Pages).
  base: "./",
  plugins: [react()],
  optimizeDeps: {
    // wasm-bindgen output loads its .wasm file via `new URL(..., import.meta.url)`;
    // pre-bundling would break that path in dev.
    exclude: ["@minigraf/browser"],
  },
  build: {
    target: "es2022",
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
  },
});
