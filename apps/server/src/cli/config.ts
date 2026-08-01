import * as NetService from "@grillme/shared/Net";
import { PortSchema } from "@grillme/contracts";
import * as Config from "effect/Config";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as LogLevel from "effect/LogLevel";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { Argument, Flag } from "effect/unstable/cli";

import * as ServerConfig from "../config.ts";
import { expandHomePath, resolveBaseDir } from "../os-jank.ts";

export const modeFlag = Flag.choice("mode", ServerConfig.RuntimeMode.literals).pipe(
  Flag.withDescription("Runtime mode for the local server."),
  Flag.optional,
);
export const portFlag = Flag.integer("port").pipe(
  Flag.withSchema(PortSchema),
  Flag.withDescription("Port for the HTTP/WebSocket server."),
  Flag.optional,
);
export const hostFlag = Flag.string("host").pipe(
  Flag.withDescription("Host/interface to bind (for example 127.0.0.1 or 0.0.0.0)."),
  Flag.optional,
);
export const baseDirFlag = Flag.string("base-dir").pipe(
  Flag.withDescription(
    "Explicit Grillme data directory; runtime state is stored under userdata (equivalent to GRILLME_HOME).",
  ),
  Flag.optional,
);
export const devUrlFlag = Flag.string("dev-url").pipe(
  Flag.withSchema(Schema.URLFromString),
  Flag.withDescription("Dev web URL to proxy/redirect to (equivalent to VITE_DEV_SERVER_URL)."),
  Flag.optional,
);
export const noBrowserFlag = Flag.boolean("no-browser").pipe(
  Flag.withDescription("Disable automatic browser opening."),
  Flag.optional,
);
export const autoBootstrapProjectFromCwdFlag = Flag.boolean("auto-bootstrap-project-from-cwd").pipe(
  Flag.withDescription(
    "Create a project for the current working directory on startup when missing.",
  ),
  Flag.optional,
);
export const logWebSocketEventsFlag = Flag.boolean("log-websocket-events").pipe(
  Flag.withDescription(
    "Emit server-side logs for outbound WebSocket push traffic (equivalent to GRILLME_LOG_WS_EVENTS).",
  ),
  Flag.withAlias("log-ws-events"),
  Flag.optional,
);
const EnvServerConfig = Config.all({
  logLevel: Config.logLevel("GRILLME_LOG_LEVEL").pipe(Config.withDefault("Info")),
  traceMinLevel: Config.logLevel("GRILLME_TRACE_MIN_LEVEL").pipe(Config.withDefault("Info")),
  traceTimingEnabled: Config.boolean("GRILLME_TRACE_TIMING_ENABLED").pipe(Config.withDefault(true)),
  traceFile: Config.string("GRILLME_TRACE_FILE").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  traceMaxBytes: Config.int("GRILLME_TRACE_MAX_BYTES").pipe(Config.withDefault(10 * 1024 * 1024)),
  traceMaxFiles: Config.int("GRILLME_TRACE_MAX_FILES").pipe(Config.withDefault(10)),
  traceBatchWindowMs: Config.int("GRILLME_TRACE_BATCH_WINDOW_MS").pipe(Config.withDefault(1_000)),
  mode: Config.schema(ServerConfig.RuntimeMode, "GRILLME_MODE").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  port: Config.port("GRILLME_PORT").pipe(Config.option, Config.map(Option.getOrUndefined)),
  host: Config.string("GRILLME_HOST").pipe(Config.option, Config.map(Option.getOrUndefined)),
  grillmeHome: Config.string("GRILLME_HOME").pipe(Config.option, Config.map(Option.getOrUndefined)),
  devUrl: Config.url("VITE_DEV_SERVER_URL").pipe(Config.option, Config.map(Option.getOrUndefined)),
  devAllowedOrigins: Config.string("GRILLME_DEV_ALLOWED_ORIGINS").pipe(
    Config.withDefault(""),
    Config.map((value) =>
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  ),
  noBrowser: Config.boolean("GRILLME_NO_BROWSER").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  autoBootstrapProjectFromCwd: Config.boolean("GRILLME_AUTO_BOOTSTRAP_PROJECT_FROM_CWD").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  logWebSocketEvents: Config.boolean("GRILLME_LOG_WS_EVENTS").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
});

export interface CliServerFlags {
  readonly mode: Option.Option<ServerConfig.RuntimeMode>;
  readonly port: Option.Option<number>;
  readonly host: Option.Option<string>;
  readonly baseDir: Option.Option<string>;
  readonly cwd: Option.Option<string>;
  readonly devUrl: Option.Option<URL>;
  readonly noBrowser: Option.Option<boolean>;
  readonly autoBootstrapProjectFromCwd: Option.Option<boolean>;
  readonly logWebSocketEvents: Option.Option<boolean>;
}

export interface CliAuthLocationFlags {
  readonly baseDir: Option.Option<string>;
  readonly devUrl?: Option.Option<URL>;
}

export const sharedServerLocationFlags = {
  baseDir: baseDirFlag,
  devUrl: devUrlFlag,
} as const;

export const projectLocationFlags = {
  baseDir: baseDirFlag,
} as const;

export const sharedServerCommandFlags = {
  mode: modeFlag,
  port: portFlag,
  host: hostFlag,
  baseDir: baseDirFlag,
  cwd: Argument.string("cwd").pipe(
    Argument.withDescription(
      "Working directory for provider sessions (defaults to the current directory).",
    ),
    Argument.optional,
  ),
  devUrl: devUrlFlag,
  noBrowser: noBrowserFlag,
  autoBootstrapProjectFromCwd: autoBootstrapProjectFromCwdFlag,
  logWebSocketEvents: logWebSocketEventsFlag,
} as const;

export const grillmeServerCommandFlags = {
  port: portFlag,
  baseDir: baseDirFlag,
  noBrowser: noBrowserFlag,
} as const;

export const authLocationFlags = sharedServerLocationFlags;

const resolveOptionPrecedence = <Value>(
  ...values: ReadonlyArray<Option.Option<Value>>
): Option.Option<Value> => Option.firstSomeOf(values);

export const resolveServerConfig = (
  flags: CliServerFlags,
  cliLogLevel: Option.Option<LogLevel.LogLevel>,
  options?: {
    readonly startupPresentation?: ServerConfig.StartupPresentation;
    readonly forceAutoBootstrapProjectFromCwd?: boolean;
  },
) =>
  Effect.gen(function* () {
    const { findAvailablePort } = yield* NetService.NetService;
    const path = yield* Path.Path;
    const fs = yield* FileSystem.FileSystem;
    const env = yield* EnvServerConfig;
    const normalizedFlags = {
      mode: flags.mode ?? Option.none(),
      port: flags.port ?? Option.none(),
      host: flags.host ?? Option.none(),
      baseDir: flags.baseDir ?? Option.none(),
      cwd: flags.cwd ?? Option.none(),
      devUrl: flags.devUrl ?? Option.none(),
      noBrowser: flags.noBrowser ?? Option.none(),
      autoBootstrapProjectFromCwd: flags.autoBootstrapProjectFromCwd ?? Option.none(),
      logWebSocketEvents: flags.logWebSocketEvents ?? Option.none(),
    } satisfies CliServerFlags;

    const mode: ServerConfig.RuntimeMode = Option.getOrElse(
      resolveOptionPrecedence(normalizedFlags.mode, Option.fromUndefinedOr(env.mode)),
      () => "web",
    );

    const port = yield* Option.match(
      resolveOptionPrecedence(normalizedFlags.port, Option.fromUndefinedOr(env.port)),
      {
        onSome: (value) => Effect.succeed(value),
        onNone: () => {
          return findAvailablePort(ServerConfig.DEFAULT_PORT);
        },
      },
    );
    const devUrl = Option.getOrElse(
      resolveOptionPrecedence(normalizedFlags.devUrl, Option.fromUndefinedOr(env.devUrl)),
      () => undefined,
    );
    const explicitBaseDir = resolveOptionPrecedence(
      normalizedFlags.baseDir,
      Option.fromUndefinedOr(env.grillmeHome),
    ).pipe(Option.filter((value) => value.trim().length > 0));
    const baseDir = yield* resolveBaseDir(Option.getOrUndefined(explicitBaseDir));
    const rawCwd = Option.getOrElse(normalizedFlags.cwd, () => process.cwd());
    const cwd = path.resolve(yield* expandHomePath(rawCwd.trim()));
    yield* fs.makeDirectory(cwd, { recursive: true });
    const derivedPaths = yield* ServerConfig.deriveServerPaths(baseDir, devUrl, {
      baseDirIsExplicit: Option.isSome(explicitBaseDir),
    });
    yield* ServerConfig.ensureServerDirectories(derivedPaths);
    const serverTracePath = env.traceFile ?? derivedPaths.serverTracePath;
    yield* fs.makeDirectory(path.dirname(serverTracePath), { recursive: true });
    const startupPresentation = options?.startupPresentation ?? "browser";
    const isHeadlessStartup = startupPresentation === "headless";
    const noBrowser = Option.getOrElse(
      resolveOptionPrecedence(
        isHeadlessStartup ? Option.some(true) : Option.none(),
        normalizedFlags.noBrowser,
        Option.fromUndefinedOr(env.noBrowser),
      ),
      () => false,
    );
    const autoBootstrapProjectFromCwd = Option.getOrElse(
      resolveOptionPrecedence(
        Option.fromUndefinedOr(options?.forceAutoBootstrapProjectFromCwd),
        isHeadlessStartup ? Option.some(false) : Option.none(),
        normalizedFlags.autoBootstrapProjectFromCwd,
        Option.fromUndefinedOr(env.autoBootstrapProjectFromCwd),
      ),
      () => mode === "web",
    );
    const logWebSocketEvents = Option.getOrElse(
      resolveOptionPrecedence(
        normalizedFlags.logWebSocketEvents,
        Option.fromUndefinedOr(env.logWebSocketEvents),
      ),
      () => Boolean(devUrl),
    );
    const staticDir = devUrl ? undefined : yield* ServerConfig.resolveStaticDir();
    const host = Option.getOrElse(
      resolveOptionPrecedence(normalizedFlags.host, Option.fromUndefinedOr(env.host)),
      () => "127.0.0.1",
    );
    const logLevel = Option.getOrElse(cliLogLevel, () => env.logLevel);

    const config: ServerConfig.ServerConfig["Service"] = {
      logLevel,
      traceMinLevel: env.traceMinLevel,
      traceTimingEnabled: env.traceTimingEnabled,
      traceBatchWindowMs: env.traceBatchWindowMs,
      traceMaxBytes: env.traceMaxBytes,
      traceMaxFiles: env.traceMaxFiles,
      mode,
      port,
      cwd,
      baseDir,
      ...derivedPaths,
      serverTracePath,
      host,
      staticDir,
      devUrl,
      devAllowedOrigins: env.devAllowedOrigins,
      noBrowser,
      startupPresentation,
      autoBootstrapProjectFromCwd,
      logWebSocketEvents,
    };

    return config;
  });

export const resolveCliAuthConfig = (
  flags: CliAuthLocationFlags,
  cliLogLevel: Option.Option<LogLevel.LogLevel>,
) =>
  resolveServerConfig(
    {
      mode: Option.none(),
      port: Option.none(),
      host: Option.none(),
      baseDir: flags.baseDir,
      cwd: Option.none(),
      devUrl: flags.devUrl ?? Option.none(),
      noBrowser: Option.none(),
      autoBootstrapProjectFromCwd: Option.none(),
      logWebSocketEvents: Option.none(),
    },
    cliLogLevel,
  );

const DurationShorthandPattern = /^(?<value>\d+)(?<unit>ms|s|m|h|d|w)$/i;

const parseDurationInput = (value: string): Duration.Duration | null => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const shorthand = DurationShorthandPattern.exec(trimmed);
  const normalizedInput = shorthand?.groups
    ? (() => {
        const amountText = shorthand.groups.value;
        const unitText = shorthand.groups.unit;
        if (typeof amountText !== "string" || typeof unitText !== "string") {
          return null;
        }

        const amount = Number.parseInt(amountText, 10);
        if (!Number.isFinite(amount)) return null;

        switch (unitText.toLowerCase()) {
          case "ms":
            return `${amount} millis`;
          case "s":
            return `${amount} seconds`;
          case "m":
            return `${amount} minutes`;
          case "h":
            return `${amount} hours`;
          case "d":
            return `${amount} days`;
          case "w":
            return `${amount} weeks`;
          default:
            return null;
        }
      })()
    : (trimmed as Duration.Input);

  if (normalizedInput === null) return null;

  const decoded = Duration.fromInput(normalizedInput as Duration.Input);
  return Option.isSome(decoded) ? decoded.value : null;
};

export const DurationFromString = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Duration,
    SchemaTransformation.transformOrFail({
      decode: (value) => {
        const duration = parseDurationInput(value);
        if (duration !== null) {
          return Effect.succeed(duration);
        }
        return Effect.fail(
          new SchemaIssue.InvalidValue(Option.some(value), {
            message: "Invalid duration. Use values like 5m, 1h, 30d, or 15 minutes.",
          }),
        );
      },
      encode: (duration) => Effect.succeed(Duration.format(duration)),
    }),
  ),
);
