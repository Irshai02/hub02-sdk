import { defineConfig } from "tsup";

export default defineConfig([
  // ESM + CJS + types for the library entrypoints.
  {
    entry: {
      client: "src/client.ts",
      server: "src/server.ts",
      react: "src/react.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    splitting: false,
    external: ["react", "jose"],
  },
  // Standalone IIFE browser bundle exposing window.hub02 (client only).
  // Output filename: dist/sdk.global.js
  {
    entry: { sdk: "src/global.ts" },
    format: ["iife"],
    outExtension() {
      return { js: ".global.js" };
    },
    globalName: "hub02",
    platform: "browser",
    minify: true,
    sourcemap: true,
    dts: false,
    // Re-export default onto window.hub02 rather than window.hub02.default.
    footer: {
      js: "if(typeof window!=='undefined'&&window.hub02&&window.hub02.default){window.hub02=window.hub02.default;}",
    },
  },
]);
