import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { Command } from "effect/unstable/cli";

import * as NetService from "@grillme/shared/Net";
import packageJson from "../package.json" with { type: "json" };
import { grillmeServerCommandFlags } from "./cli/config.ts";
import { runServerCommand } from "./cli/server.ts";

const CliRuntimeLayer = Layer.mergeAll(NodeServices.layer, NetService.layer);

export const makeCli = () =>
  Command.make("grillme", { ...grillmeServerCommandFlags }).pipe(
    Command.withDescription("Start a local Grillme interview session."),
    Command.withHandler((flags) =>
      runServerCommand({
        mode: Option.some("web"),
        port: flags.port,
        host: Option.some("127.0.0.1"),
        baseDir: flags.baseDir,
        cwd: Option.none(),
        devUrl: Option.none(),
        noBrowser: flags.noBrowser,
        autoBootstrapProjectFromCwd: Option.some(true),
        logWebSocketEvents: Option.none(),
      }),
    ),
  );

export const cli = makeCli();

if (import.meta.main) {
  Command.run(cli, { version: packageJson.version }).pipe(
    Effect.scoped,
    Effect.provide(CliRuntimeLayer),
    NodeRuntime.runMain,
  );
}
