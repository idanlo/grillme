import "vite-plus/test/config";
import { defineConfig, mergeConfig } from "vite-plus";

import baseConfig from "../../vite.config.ts";
import packageJson from "./package.json" with { type: "json" };

const bundledPackagePrefixes = [
  "@pierre/diffs",
  "@grillme/",
  "effect-acp",
  "effect-codex-app-server",
];

export function shouldBundleCliDependency(id: string): boolean {
  return bundledPackagePrefixes.some((prefix) => id.startsWith(prefix));
}

export default mergeConfig(
  baseConfig,
  defineConfig({
    run: {
      tasks: {
        build: {
          command: "node scripts/cli.ts build",
          dependsOn: ["@grillme/grillme#build"],
          cache: false,
        },
        serve: {
          command: "node dist/bin.mjs",
          dependsOn: ["build"],
          cache: false,
        },
      },
    },
    pack: {
      entry: ["src/bin.ts"],
      outDir: "dist",
      sourcemap: true,
      clean: true,
      deps: {
        alwaysBundle: shouldBundleCliDependency,
        onlyBundle: false,
      },
      banner: {
        js: "#!/usr/bin/env node\n",
      },
      define: {
        __GRILLME_BUILD_VERSION__: JSON.stringify(packageJson.version),
      },
    },
    test: {
      // The server suite exercises sqlite, git, temp worktrees, and orchestration
      // runtimes heavily. Running files in parallel introduces load-sensitive flakes.
      fileParallelism: false,
      // Server integration tests exercise sqlite, git, and orchestration together.
      // Under package-wide runs they can exceed the default budget on loaded CI hosts.
      hookTimeout: 120_000,
      testTimeout: 120_000,
    },
  }),
);
