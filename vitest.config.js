import { defineConfig } from "vitest/config";

export default defineConfig({
  // The same classic JSX as scripts/build.mjs.
  esbuild: { jsx: "transform", jsxFactory: "h", jsxFragment: "Fragment" },
  test: {
    include: ["test/**/*.test.{js,jsx}"],
    environment: "node",
  },
});
