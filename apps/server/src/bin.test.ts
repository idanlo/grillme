import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NetService from "@grillme/shared/Net";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as CliError from "effect/unstable/cli/CliError";
import { Command } from "effect/unstable/cli";
import * as TestConsole from "effect/testing/TestConsole";

import { cli } from "./bin.ts";

const CliRuntimeLayer = Layer.mergeAll(NodeServices.layer, NetService.layer);
const runCli = (args: ReadonlyArray<string>) =>
  Command.runWith(cli, { version: "0.0.0" })(args).pipe(Effect.provide(CliRuntimeLayer));

it.layer(TestConsole.layer)("Grillme CLI", (it) => {
  it.effect("identifies itself as Grillme", () =>
    Effect.gen(function* () {
      yield* runCli(["--help"]);
      const output = (yield* TestConsole.logLines).join("\n");

      assert.include(output, "grillme");
      assert.include(output, "Start a local Grillme interview session.");
      assert.notInclude(output, "connect");
      assert.notInclude(output, "service");
      assert.notInclude(output, "tailscale");
      assert.notInclude(output, "--host");
    }),
  );

  it.effect("does not accept a prompt as a positional directory", () =>
    Effect.gen(function* () {
      const error = yield* runCli(["design my feature"]).pipe(Effect.flip);
      assert.isTrue(CliError.isCliError(error));
    }),
  );

  it.effect("accepts local startup flags", () =>
    runCli(["--port", "4400", "--base-dir", "/tmp/grillme-test", "--no-browser", "--help"]),
  );
});
