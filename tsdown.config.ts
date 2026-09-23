import babel from "@rolldown/plugin-babel";
import solid from "@solidjs/babel-plugin";
import { defineConfig } from "tsdown";

const solidPlugin = (dev: boolean) =>
  babel({
    plugins: [
      [
        solid,
        {
          moduleName: "@solidjs/web",
          generate: "dom",
          hydratable: true,
          dev,
        },
      ],
    ],
  });

export default defineConfig([
  {
    entry: { index: "src/index.tsx" },
    platform: "neutral",
    target: "esnext",
    dts: true,
    clean: true,
    plugins: [solidPlugin(false)],
  },
  {
    entry: { dev: "src/index.tsx" },
    platform: "neutral",
    target: "esnext",
    dts: false,
    plugins: [solidPlugin(true)],
  },
  {
    entry: {
      index: "src/index.tsx",
      dev: "src/index.tsx",
    },
    platform: "neutral",
    target: "esnext",
    dts: false,
    outExtensions: () => ({ js: ".jsx" }),
  },
]);
