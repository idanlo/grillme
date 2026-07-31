import { expect, it } from "vite-plus/test";

import packageJson from "../package.json" with { type: "json" };
import { createVpPmPublishArgs, PUBLISHED_PACKAGE_NAME } from "./cli.ts";

it("publishes the server workspace under the Grillme npm identity", () => {
  expect(PUBLISHED_PACKAGE_NAME).toBe("grillme");
  expect(packageJson.bin).toEqual({ grillme: "./dist/bin.mjs" });
  expect(
    createVpPmPublishArgs({
      access: "public",
      tag: "latest",
      provenance: false,
      dryRun: true,
    }),
  ).toContain("./apps/server");
});
