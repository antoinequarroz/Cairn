import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The "@/…" imports of tsconfig.json, for the tests of modules that use them.
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
