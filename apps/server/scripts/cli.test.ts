import { expect, it } from "vite-plus/test";

import packageJson from "../package.json" with { type: "json" };
import {
  createPublishProcessOptions,
  createVpPmPublishArgs,
  PUBLISHED_README_FILENAME,
  withReadmeMetadata,
} from "./cli.ts";

it("publishes the Grillme CLI package under its workspace identity", () => {
  expect(packageJson.name).toBe("grillme");
  expect("private" in packageJson).toBe(false);
  expect(packageJson.version).toBe("0.1.1");
  expect(packageJson.license).toBe("MIT");
  expect(packageJson.bin).toEqual({ grillme: "./dist/bin.mjs" });
  expect(
    createVpPmPublishArgs({
      access: "public",
      tag: "latest",
      provenance: false,
      dryRun: true,
    }),
  ).toContain("grillme");
});

it("includes README metadata in the registry publish manifest", () => {
  expect(withReadmeMetadata({ name: "grillme" }, "# Grillme\n")).toEqual({
    name: "grillme",
    readme: "# Grillme\n",
    readmeFilename: PUBLISHED_README_FILENAME,
  });
});

it("inherits stdin so pnpm can request a publish-time OTP", () => {
  expect(createPublishProcessOptions("/repo", true, false)).toEqual({
    cwd: "/repo",
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    shell: false,
  });
});
