#!/usr/bin/env node

import * as NodeOS from "node:os";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NetService from "@grillme/shared/Net";
import { resolveGitWorktreePath, resolveWorktreeGrillmeHome } from "@grillme/shared/devHome";
import { HostProcessEnvironment, HostProcessWorkingDirectory } from "@grillme/shared/hostProcess";
import { resolveSpawnCommand } from "@grillme/shared/shell";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Hash from "effect/Hash";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { ChildProcess } from "effect/unstable/process";

const BASE_SERVER_PORT = 13773;
const BASE_WEB_PORT = 5733;
const MAX_HASH_OFFSET = 3000;
const MAX_PORT = 65535;
// HTTP(S) requests to these ports are blocked by the Fetch standard before a
// browser reaches the network. Keep the complete list here so explicit or
// future wider offsets cannot produce a URL that curl accepts but browsers
// reject. https://fetch.spec.whatwg.org/#port-blocking
const FETCH_BAD_PORTS = new Set([
  0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
  103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
  512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
  995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668,
  6669, 6679, 6697, 10080,
]);
// Dev servers bind loopback, so loopback is the only interface whose
// availability decides whether we can use a port. Probing wildcards too made
// the runner walk away from a perfectly free port whenever something else held
// the same number on another interface, which can make a local URL unusable.
const DEV_PORT_PROBE_HOSTS = ["127.0.0.1", "::1"] as const;

/**
 * Bind hosts on which a backend still answers `http://localhost:<port>`, which
 * is where single-origin browser dev proxies to. Loopback and the wildcards
 * qualify; a specific interface (e.g. a LAN IP) does not — the OS binds only
 * that address and the proxy target goes dark.
 */
export function isProxiableBindHost(host: string): boolean {
  const normalized = host.trim();
  return (
    normalized === "" ||
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized === "0.0.0.0" ||
    normalized === "::" ||
    normalized === "[::]"
  );
}

export const DEFAULT_GRILLME_HOME = Effect.map(Effect.service(Path.Path), (path) =>
  path.join(NodeOS.homedir(), ".grillme"),
);

const MODE_ARGS = {
  dev: [
    "run",
    "--filter=@grillme/contracts",
    "--filter=@grillme/grillme",
    "--filter=@grillme/server",
    "--parallel",
    "dev",
  ],
  "dev:server": ["run", "--filter=@grillme/server", "dev"],
  "dev:web": ["run", "--filter=@grillme/grillme", "dev"],
} as const satisfies Record<string, ReadonlyArray<string>>;

type DevMode = keyof typeof MODE_ARGS;
/**
 * `role` matters because only the backend honours `--host`/`GRILLME_HOST`; the
 * web port is always loopback. Passed explicitly rather than inferred from the
 * port number, which stops distinguishing them under a large port offset.
 */
type PortAvailabilityCheck<R = never> = (
  port: number,
  role?: "server" | "web",
) => Effect.Effect<boolean, never, R>;

const DEV_RUNNER_MODES = Object.keys(MODE_ARGS) as Array<DevMode>;

export function getDevRunnerModeArgs(mode: DevMode): ReadonlyArray<string> {
  return MODE_ARGS[mode];
}

export function isBrowserAllowedPort(port: number): boolean {
  return !FETCH_BAD_PORTS.has(port);
}

export class DevRunnerConfigurationError extends Schema.TaggedErrorClass<DevRunnerConfigurationError>()(
  "DevRunnerConfigurationError",
  {
    configKeys: Schema.Array(Schema.String),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to read dev-runner configuration: ${this.configKeys.join(", ")}.`;
  }
}

export class DevRunnerInvalidPortOffsetError extends Schema.TaggedErrorClass<DevRunnerInvalidPortOffsetError>()(
  "DevRunnerInvalidPortOffsetError",
  {
    configKey: Schema.Literal("GRILLME_PORT_OFFSET"),
    portOffset: Schema.Number,
    minimum: Schema.Number,
  },
) {
  override get message(): string {
    return `${this.configKey} must be at least ${this.minimum}; received ${this.portOffset}.`;
  }
}

export class DevRunnerPortExhaustedError extends Schema.TaggedErrorClass<DevRunnerPortExhaustedError>()(
  "DevRunnerPortExhaustedError",
  {
    startOffset: Schema.Number,
    requireServerPort: Schema.Boolean,
    requireWebPort: Schema.Boolean,
    baseServerPort: Schema.Number,
    baseWebPort: Schema.Number,
    maximumPort: Schema.Number,
  },
) {
  override get message(): string {
    return `No required dev ports were available from offset ${this.startOffset} through maximum port ${this.maximumPort}.`;
  }
}

export class DevRunnerProcessError extends Schema.TaggedErrorClass<DevRunnerProcessError>()(
  "DevRunnerProcessError",
  {
    operation: Schema.Literals(["spawn", "wait-for-exit"]),
    mode: Schema.Literals(["dev", "dev:server", "dev:web"]),
    executable: Schema.Literal("vp"),
    argumentCount: Schema.Number,
    shell: Schema.Boolean,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Dev-runner process operation "${this.operation}" failed for mode "${this.mode}".`;
  }
}

export class DevRunnerProcessExitError extends Schema.TaggedErrorClass<DevRunnerProcessExitError>()(
  "DevRunnerProcessExitError",
  {
    mode: Schema.Literals(["dev", "dev:server", "dev:web"]),
    executable: Schema.Literal("vp"),
    argumentCount: Schema.Number,
    shell: Schema.Boolean,
    exitCode: Schema.Number,
  },
) {
  override get message(): string {
    return `Dev-runner process exited with code ${this.exitCode} in mode "${this.mode}".`;
  }
}

export class DevRunnerHostNotProxiableError extends Schema.TaggedErrorClass<DevRunnerHostNotProxiableError>()(
  "DevRunnerHostNotProxiableError",
  {
    mode: Schema.Literals(["dev", "dev:web"]),
    host: Schema.String,
  },
) {
  override get message(): string {
    return `--host ${this.host} cannot be combined with ${this.mode}: single-origin browser dev proxies the backend at localhost, and a backend bound only to ${this.host} leaves localhost unanswered, so every proxied request fails. Use a wildcard (0.0.0.0 or ::) to serve that interface and loopback together.`;
  }
}

export const DevRunnerError = Schema.Union([
  DevRunnerConfigurationError,
  DevRunnerHostNotProxiableError,
  DevRunnerInvalidPortOffsetError,
  DevRunnerPortExhaustedError,
  DevRunnerProcessError,
  DevRunnerProcessExitError,
]);
export type DevRunnerError = typeof DevRunnerError.Type;
export const isDevRunnerError = Schema.is(DevRunnerError);

const optionalStringConfig = (name: string): Config.Config<string | undefined> =>
  Config.string(name).pipe(
    Config.option,
    Config.map((value) => Option.getOrUndefined(value)),
  );
const optionalBooleanConfig = (name: string): Config.Config<boolean | undefined> =>
  Config.boolean(name).pipe(
    Config.option,
    Config.map((value) => Option.getOrUndefined(value)),
  );
const optionalPortConfig = (name: string): Config.Config<number | undefined> =>
  Config.port(name).pipe(
    Config.option,
    Config.map((value) => Option.getOrUndefined(value)),
  );
const optionalIntegerConfig = (name: string): Config.Config<number | undefined> =>
  Config.int(name).pipe(
    Config.option,
    Config.map((value) => Option.getOrUndefined(value)),
  );
const OffsetConfig = Config.all({
  portOffset: optionalIntegerConfig("GRILLME_PORT_OFFSET"),
  devInstance: optionalStringConfig("GRILLME_DEV_INSTANCE"),
});

export function resolveOffset(config: {
  readonly portOffset: number | undefined;
  readonly devInstance: string | undefined;
  readonly worktreePath?: string | undefined;
}): Effect.Effect<
  { readonly offset: number; readonly source: string },
  DevRunnerInvalidPortOffsetError
> {
  if (config.portOffset !== undefined) {
    if (config.portOffset < 0) {
      return Effect.fail(
        new DevRunnerInvalidPortOffsetError({
          configKey: "GRILLME_PORT_OFFSET",
          portOffset: config.portOffset,
          minimum: 0,
        }),
      );
    }
    return Effect.succeed({
      offset: config.portOffset,
      source: `GRILLME_PORT_OFFSET=${config.portOffset}`,
    });
  }

  const seed = config.devInstance?.trim();
  if (seed) {
    if (/^\d+$/.test(seed)) {
      return Effect.succeed({
        offset: Number(seed),
        source: `numeric GRILLME_DEV_INSTANCE=${seed}`,
      });
    }

    const offset = ((Hash.string(seed) >>> 0) % MAX_HASH_OFFSET) + 1;
    return Effect.succeed({ offset, source: `hashed GRILLME_DEV_INSTANCE=${seed}` });
  }

  // Worktrees get ports derived from their path so each one is stable across
  // restarts and distinct from its siblings. Without this every worktree starts
  // at offset 0 and scan-collides onto whatever happens to be free that minute,
  // so ports move under you between runs — which breaks any URL you already
  // shared. The main checkout keeps the documented 5733/13773.
  const worktreePath = config.worktreePath?.trim();
  if (worktreePath) {
    const offset = ((Hash.string(worktreePath) >>> 0) % MAX_HASH_OFFSET) + 1;
    return Effect.succeed({ offset, source: `worktree ${worktreePath}` });
  }

  return Effect.succeed({ offset: 0, source: "default ports" });
}

function resolveBaseDir(baseDir: string | undefined): Effect.Effect<string, never, Path.Path> {
  return Effect.gen(function* () {
    const path = yield* Path.Path;
    const configured = baseDir?.trim();

    if (configured) {
      return path.resolve(configured);
    }

    return yield* DEFAULT_GRILLME_HOME;
  });
}

interface CreateDevRunnerEnvInput {
  readonly mode: DevMode;
  readonly baseEnv: NodeJS.ProcessEnv;
  readonly serverOffset: number;
  readonly webOffset: number;
  readonly grillmeHome: string | undefined;
  readonly browser: boolean | undefined;
  readonly autoBootstrapProjectFromCwd: boolean | undefined;
  readonly logWebSocketEvents: boolean | undefined;
  readonly host: string | undefined;
  readonly port: number | undefined;
  readonly devUrl: URL | undefined;
}

export function createDevRunnerEnv({
  mode,
  baseEnv,
  serverOffset,
  webOffset,
  grillmeHome,
  browser,
  autoBootstrapProjectFromCwd,
  logWebSocketEvents,
  host,
  port,
  devUrl,
}: CreateDevRunnerEnvInput): Effect.Effect<NodeJS.ProcessEnv, never, Path.Path> {
  return Effect.gen(function* () {
    const serverPort = port ?? BASE_SERVER_PORT + serverOffset;
    const webPort = BASE_WEB_PORT + webOffset;
    // Precedence (--home-dir > worktree .grillme > ambient GRILLME_HOME) is resolved
    // by the caller; an unset grillmeHome here genuinely means "use the default".
    const configuredBaseDir = grillmeHome?.trim() || undefined;
    const resolvedBaseDir = yield* resolveBaseDir(configuredBaseDir);
    const output: NodeJS.ProcessEnv = {
      ...baseEnv,
      PORT: String(webPort),
      VITE_DEV_SERVER_URL: devUrl?.toString() ?? `http://localhost:${webPort}`,
    };

    if (configuredBaseDir !== undefined) {
      output.GRILLME_HOME = resolvedBaseDir;
    } else {
      delete output.GRILLME_HOME;
    }

    output.GRILLME_PORT = String(serverPort);
    // HOST is Vite's bind address. An inherited one (an exported HOST, a
    // container, a `HOST=0.0.0.0 npm start` habit) would otherwise reach Vite
    // and pin its HMR socket to that address — see the `explicitHost` gate in
    // apps/grillme/vite.config.ts. Over a shared origin that is invisible: the page
    // loads and only HMR quietly dials the wrong machine.
    delete output.HOST;
    if (mode === "dev" || mode === "dev:web") {
      // Browser dev is single-origin: everything (including /ws) is proxied
      // through Vite, so the client must resolve its backend from
      // window.location.origin rather than a baked-in localhost URL.
      delete output.VITE_HTTP_URL;
      delete output.VITE_WS_URL;
      output.GRILLME_SINGLE_ORIGIN_DEV = "1";
    } else {
      output.VITE_HTTP_URL = `http://localhost:${serverPort}`;
      output.VITE_WS_URL = `ws://localhost:${serverPort}`;
      delete output.GRILLME_SINGLE_ORIGIN_DEV;
    }

    if (host !== undefined) {
      output.GRILLME_HOST = host;
    }

    output.GRILLME_NO_BROWSER = browser === true ? "0" : "1";

    if (autoBootstrapProjectFromCwd !== undefined) {
      output.GRILLME_AUTO_BOOTSTRAP_PROJECT_FROM_CWD = autoBootstrapProjectFromCwd ? "1" : "0";
    } else {
      delete output.GRILLME_AUTO_BOOTSTRAP_PROJECT_FROM_CWD;
    }

    if (logWebSocketEvents !== undefined) {
      output.GRILLME_LOG_WS_EVENTS = logWebSocketEvents ? "1" : "0";
    } else {
      delete output.GRILLME_LOG_WS_EVENTS;
    }

    if (mode === "dev") {
      output.GRILLME_MODE = "web";
    }

    if (mode === "dev:server" || mode === "dev:web") {
      output.GRILLME_MODE = "web";
    }

    return output;
  });
}

function portPairForOffset(offset: number): {
  readonly serverPort: number;
  readonly webPort: number;
} {
  return {
    serverPort: BASE_SERVER_PORT + offset,
    webPort: BASE_WEB_PORT + offset,
  };
}

export function checkPortAvailabilityOnHosts<R>(
  port: number,
  hosts: ReadonlyArray<string>,
  canListenOnHost: (port: number, host: string) => Effect.Effect<boolean, never, R>,
): Effect.Effect<boolean, never, R> {
  return Effect.gen(function* () {
    for (const host of hosts) {
      if (!(yield* canListenOnHost(port, host))) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Hosts to probe for a dev server bound to `configuredHost`.
 *
 * Loopback is always checked because the web server reaches it there. When
 * `--host`/`GRILLME_HOST` moves the backend onto
 * another interface, that interface decides whether the bind actually
 * succeeds — probing only loopback would hand back a port that is free here
 * and taken there, and the server would fail to start.
 *
 * `configuredHost` applies to the *backend* only. The web port stays on
 * loopback and must not be judged against the backend's interface —
 * a port free on loopback but busy on that interface would otherwise be
 * rejected for a server that was never going to bind there.
 */
export function devPortProbeHosts(configuredHost: string | undefined): ReadonlyArray<string> {
  const host = configuredHost?.trim();
  if (!host || DEV_PORT_PROBE_HOSTS.includes(host as (typeof DEV_PORT_PROBE_HOSTS)[number])) {
    return DEV_PORT_PROBE_HOSTS;
  }
  return [...DEV_PORT_PROBE_HOSTS, host];
}

const makeDefaultCheckPortAvailability =
  (configuredHost: string | undefined): PortAvailabilityCheck<NetService.NetService> =>
  (port, role) =>
    Effect.gen(function* () {
      const net = yield* NetService.NetService;
      const hosts = role === "web" ? DEV_PORT_PROBE_HOSTS : devPortProbeHosts(configuredHost);
      return yield* checkPortAvailabilityOnHosts(port, hosts, (candidatePort, host) =>
        net.canListenOnHost(candidatePort, host),
      );
    });

const defaultCheckPortAvailability = makeDefaultCheckPortAvailability(undefined);

interface FindFirstAvailableOffsetInput<R = NetService.NetService> {
  readonly startOffset: number;
  readonly requireServerPort: boolean;
  readonly requireWebPort: boolean;
  readonly checkPortAvailability?: PortAvailabilityCheck<R>;
}

export function findFirstAvailableOffset<R = NetService.NetService>({
  startOffset,
  requireServerPort,
  requireWebPort,
  checkPortAvailability,
}: FindFirstAvailableOffsetInput<R>): Effect.Effect<number, DevRunnerPortExhaustedError, R> {
  return Effect.gen(function* () {
    const checkPort = (checkPortAvailability ??
      defaultCheckPortAvailability) as PortAvailabilityCheck<R>;

    for (let candidate = startOffset; ; candidate += 1) {
      const { serverPort, webPort } = portPairForOffset(candidate);
      const serverPortOutOfRange = serverPort > MAX_PORT;
      const webPortOutOfRange = webPort > MAX_PORT;

      if (
        (requireServerPort && serverPortOutOfRange) ||
        (requireWebPort && webPortOutOfRange) ||
        (!requireServerPort && !requireWebPort && (serverPortOutOfRange || webPortOutOfRange))
      ) {
        break;
      }

      if (requireWebPort && !isBrowserAllowedPort(webPort)) {
        continue;
      }

      const checks: Array<Effect.Effect<boolean, never, R>> = [];
      if (requireServerPort) {
        checks.push(checkPort(serverPort, "server"));
      }
      if (requireWebPort) {
        checks.push(checkPort(webPort, "web"));
      }

      if (checks.length === 0) {
        return candidate;
      }

      const availability = yield* Effect.all(checks);
      if (availability.every(Boolean)) {
        return candidate;
      }
    }

    return yield* new DevRunnerPortExhaustedError({
      startOffset,
      requireServerPort,
      requireWebPort,
      baseServerPort: BASE_SERVER_PORT,
      baseWebPort: BASE_WEB_PORT,
      maximumPort: MAX_PORT,
    });
  });
}

interface ResolveModePortOffsetsInput<R = NetService.NetService> {
  readonly mode: DevMode;
  readonly startOffset: number;
  readonly hasExplicitServerPort: boolean;
  readonly hasExplicitDevUrl: boolean;
  readonly checkPortAvailability?: PortAvailabilityCheck<R>;
}

export function resolveModePortOffsets<R = NetService.NetService>({
  mode,
  startOffset,
  hasExplicitServerPort,
  hasExplicitDevUrl,
  checkPortAvailability,
}: ResolveModePortOffsetsInput<R>): Effect.Effect<
  { readonly serverOffset: number; readonly webOffset: number },
  DevRunnerPortExhaustedError,
  R
> {
  return Effect.gen(function* () {
    const checkPort = (checkPortAvailability ??
      defaultCheckPortAvailability) as PortAvailabilityCheck<R>;

    if (mode === "dev:web") {
      if (hasExplicitDevUrl) {
        return { serverOffset: startOffset, webOffset: startOffset };
      }

      const webOffset = yield* findFirstAvailableOffset({
        startOffset,
        requireServerPort: false,
        requireWebPort: true,
        checkPortAvailability: checkPort,
      });
      return { serverOffset: startOffset, webOffset };
    }

    if (mode === "dev:server") {
      if (hasExplicitServerPort) {
        return { serverOffset: startOffset, webOffset: startOffset };
      }

      const serverOffset = yield* findFirstAvailableOffset({
        startOffset,
        requireServerPort: true,
        requireWebPort: false,
        checkPortAvailability: checkPort,
      });
      return { serverOffset, webOffset: serverOffset };
    }

    const sharedOffset = yield* findFirstAvailableOffset({
      startOffset,
      requireServerPort: !hasExplicitServerPort,
      requireWebPort: !hasExplicitDevUrl,
      checkPortAvailability: checkPort,
    });

    return { serverOffset: sharedOffset, webOffset: sharedOffset };
  });
}

interface DevRunnerCliInput {
  readonly mode: DevMode;
  readonly grillmeHome: string | undefined;
  readonly browser: boolean | undefined;
  readonly autoBootstrapProjectFromCwd: boolean | undefined;
  readonly logWebSocketEvents: boolean | undefined;
  readonly host: string | undefined;
  readonly port: number | undefined;
  readonly devUrl: URL | undefined;
  readonly dryRun: boolean;
  readonly runArgs: ReadonlyArray<string>;
}

export function runDevRunnerWithInput(input: DevRunnerCliInput) {
  return Effect.gen(function* () {
    const { portOffset, devInstance } = yield* OffsetConfig.pipe(
      Effect.mapError(
        (cause) =>
          new DevRunnerConfigurationError({
            configKeys: ["GRILLME_PORT_OFFSET", "GRILLME_DEV_INSTANCE"],
            cause,
          }),
      ),
    );

    // Single-origin browser dev proxies the backend at localhost. A wildcard
    // bind still answers there; a specific non-loopback interface does not,
    // which breaks every proxied request in a way that reads as "server is
    // broken" rather than "flag combination is unsupported". Reject it up
    // front instead. (dev:server does not proxy and is untouched.)
    if (
      (input.mode === "dev" || input.mode === "dev:web") &&
      input.host !== undefined &&
      !isProxiableBindHost(input.host)
    ) {
      return yield* new DevRunnerHostNotProxiableError({ mode: input.mode, host: input.host });
    }

    const worktreePath = yield* resolveGitWorktreePath(yield* HostProcessWorkingDirectory);

    const { offset, source } = yield* resolveOffset({
      portOffset,
      devInstance,
      worktreePath,
    });

    const { serverOffset, webOffset } = yield* resolveModePortOffsets({
      mode: input.mode,
      startOffset: offset,
      hasExplicitServerPort: input.port !== undefined,
      hasExplicitDevUrl: input.devUrl !== undefined,
      // A non-loopback bind host decides whether the backend can actually take
      // the port, so it has to be probed alongside loopback.
      checkPortAvailability: makeDefaultCheckPortAvailability(input.host),
    });

    const hostEnvironment = yield* HostProcessEnvironment;
    // A dev server started inside a worktree defaults to that worktree's own
    // (gitignored) `.grillme` — see @grillme/shared/devHome for why this must
    // outrank an ambient GRILLME_HOME. `--home-dir` still wins.
    const worktreeHome = yield* resolveWorktreeGrillmeHome(yield* HostProcessWorkingDirectory);
    // Trim before choosing: `--home-dir ""` is not a selection, and treating it
    // as one would skip the worktree default and land on the shared home —
    // exactly the outcome this precedence exists to prevent.
    const resolvedGrillmeHome =
      (input.grillmeHome?.trim() || undefined) ??
      worktreeHome ??
      (hostEnvironment.GRILLME_HOME?.trim() || undefined);
    const env = yield* createDevRunnerEnv({
      mode: input.mode,
      baseEnv: hostEnvironment,
      serverOffset,
      webOffset,
      grillmeHome: resolvedGrillmeHome,
      browser: input.browser,
      autoBootstrapProjectFromCwd: input.autoBootstrapProjectFromCwd,
      logWebSocketEvents: input.logWebSocketEvents,
      host: input.host,
      port: input.port,
      devUrl: input.devUrl,
    });

    const selectionSuffix =
      serverOffset !== offset || webOffset !== offset
        ? ` selectedOffset(server=${serverOffset},web=${webOffset})`
        : "";
    const baseDir = env.GRILLME_HOME ?? (yield* DEFAULT_GRILLME_HOME);

    yield* Effect.logInfo(
      `[dev-runner] mode=${input.mode} source=${source}${selectionSuffix} serverPort=${String(env.GRILLME_PORT)} webPort=${String(env.PORT)} baseDir=${baseDir}`,
    );

    if (input.dryRun) {
      return;
    }

    const spawnCommand = yield* resolveSpawnCommand(
      "vp",
      [...MODE_ARGS[input.mode], ...input.runArgs],
      { env },
    );
    const processContext = {
      mode: input.mode,
      executable: "vp" as const,
      argumentCount: spawnCommand.args.length,
      shell: spawnCommand.shell,
    } as const;
    const child = yield* ChildProcess.make(spawnCommand.command, spawnCommand.args, {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      env,
      extendEnv: false,
      shell: spawnCommand.shell,
      // Keep Vite+ in the same process group so terminal signals (Ctrl+C)
      // reach it directly. Effect defaults to detached: true on non-Windows,
      // which would put the runner in a new group and require manual forwarding.
      detached: false,
      forceKillAfter: "1500 millis",
    }).pipe(
      Effect.mapError(
        (cause) =>
          new DevRunnerProcessError({
            ...processContext,
            operation: "spawn",
            cause,
          }),
      ),
    );

    const exitCode = yield* child.exitCode.pipe(
      Effect.mapError(
        (cause) =>
          new DevRunnerProcessError({
            ...processContext,
            operation: "wait-for-exit",
            cause,
          }),
      ),
    );
    if (exitCode !== 0) {
      return yield* new DevRunnerProcessExitError({
        ...processContext,
        exitCode,
      });
    }
  });
}

const devRunnerCli = Command.make("dev-runner", {
  mode: Argument.choice("mode", DEV_RUNNER_MODES).pipe(
    Argument.withDescription("Development mode to run."),
  ),
  grillmeHome: Flag.string("home-dir").pipe(
    Flag.withDescription(
      "Explicit Grillme data directory; runtime state is stored under userdata (equivalent to GRILLME_HOME). Inside a git worktree this defaults to that worktree's own .grillme so dev state stays off the shared home.",
    ),
    Flag.optional,
    Flag.map(Option.getOrUndefined),
  ),
  browser: Flag.boolean("browser").pipe(
    Flag.withDescription("Open a browser automatically (disabled by default for web dev)."),
  ),
  autoBootstrapProjectFromCwd: Flag.boolean("auto-bootstrap-project-from-cwd").pipe(
    Flag.withDescription(
      "Auto-bootstrap toggle (equivalent to GRILLME_AUTO_BOOTSTRAP_PROJECT_FROM_CWD).",
    ),
    Flag.withFallbackConfig(optionalBooleanConfig("GRILLME_AUTO_BOOTSTRAP_PROJECT_FROM_CWD")),
  ),
  logWebSocketEvents: Flag.boolean("log-websocket-events").pipe(
    Flag.withDescription("WebSocket event logging toggle (equivalent to GRILLME_LOG_WS_EVENTS)."),
    Flag.withAlias("log-ws-events"),
    Flag.withFallbackConfig(optionalBooleanConfig("GRILLME_LOG_WS_EVENTS")),
  ),
  host: Flag.string("host").pipe(
    Flag.withDescription("Server host/interface override (forwards to GRILLME_HOST)."),
    Flag.withFallbackConfig(optionalStringConfig("GRILLME_HOST")),
  ),
  port: Flag.integer("port").pipe(
    Flag.withSchema(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }))),
    Flag.withDescription("Server port override (forwards to GRILLME_PORT)."),
    Flag.withFallbackConfig(optionalPortConfig("GRILLME_PORT")),
  ),
  devUrl: Flag.string("dev-url").pipe(
    Flag.withSchema(Schema.URLFromString),
    Flag.withDescription(
      "Explicit web dev URL override (forwards to VITE_DEV_SERVER_URL). Ambient VITE_DEV_SERVER_URL values are ignored so a parent dev app cannot redirect the child runner.",
    ),
    Flag.optional,
    Flag.map(Option.getOrUndefined),
  ),
  dryRun: Flag.boolean("dry-run").pipe(
    Flag.withDescription("Resolve mode/ports/env and print, but do not spawn Vite+."),
    Flag.withDefault(false),
  ),
  runArgs: Argument.string("run-arg").pipe(
    Argument.withDescription("Additional Vite+ run args (pass after `--`)."),
    Argument.variadic(),
  ),
}).pipe(
  Command.withDescription("Run monorepo development modes with deterministic port/env wiring."),
  Command.withHandler((input) => runDevRunnerWithInput(input)),
);

const cliRuntimeLayer = Layer.mergeAll(
  Logger.layer([Logger.consolePretty()]),
  NodeServices.layer,
  NetService.layer,
);

if (import.meta.main) {
  Command.run(devRunnerCli, { version: "0.0.0" }).pipe(
    Effect.scoped,
    Effect.provide(cliRuntimeLayer),
    NodeRuntime.runMain,
  );
}
