import { defineConfig } from "vitest/config";

export default defineConfig({
  // The same classic JSX (h, Fragment) scripts/build.mjs ships.
  oxc: { jsx: { runtime: "classic", pragma: "h", pragmaFrag: "Fragment" } },
  test: {
    include: ["test/**/*.test.{js,jsx}"],
    environment: "node",
  },
});
