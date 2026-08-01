import {
  CommandId,
  EnvironmentAuthorizationError,
  ORCHESTRATION_WS_METHODS,
  type OrchestrationEvent,
  OrchestrationDispatchCommandError,
  OrchestrationGetSnapshotError,
  ProjectId,
  ProjectWriteFileError,
  ServerConfig as ServerConfigSchema,
  ThreadId,
  type AuthEnvironmentScope,
  WS_METHODS,
  WsServerError,
  WsRpcGroup,
} from "@grillme/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpRouter, HttpServerRequest, HttpServerRespondable } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import * as EnvironmentAuth from "./auth/EnvironmentAuth.ts";
import { failEnvironmentAuthInvalid, failEnvironmentInternal } from "./auth/http.ts";
import * as ServerConfig from "./config.ts";
import {
  projectActivityEvent,
  projectThreadDetailSnapshot,
} from "./orchestration/ActivityPayloadProjection.ts";
import { normalizeDispatchCommand } from "./orchestration/Normalizer.ts";
import * as OrchestrationEngine from "./orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProviderRegistry from "./provider/Services/ProviderRegistry.ts";
import * as ServerEnvironment from "./environment/ServerEnvironment.ts";
import * as ServerRuntimeStartup from "./serverRuntimeStartup.ts";
import * as ServerSettings from "./serverSettings.ts";
import * as SessionStore from "./auth/SessionStore.ts";
import * as WorkspaceFileSystem from "./workspace/WorkspaceFileSystem.ts";

const isDispatchError = Schema.is(OrchestrationDispatchCommandError);

const toDispatchError = (cause: unknown): OrchestrationDispatchCommandError =>
  isDispatchError(cause)
    ? cause
    : new OrchestrationDispatchCommandError({
        message:
          cause instanceof Error ? cause.message : "Failed to dispatch orchestration command.",
        cause,
      });

const toSnapshotError = (message: string, cause: unknown): OrchestrationGetSnapshotError =>
  new OrchestrationGetSnapshotError({ message, cause });

const toAuthorizationError = (scope: AuthEnvironmentScope): EnvironmentAuthorizationError =>
  new EnvironmentAuthorizationError({
    message: `The authenticated local session is missing required scope: ${scope}.`,
    requiredScope: scope,
  });

const makeWsRpcLayer = (currentSession: EnvironmentAuth.AuthenticatedSession) =>
  WsRpcGroup.toLayer(
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const environment = yield* ServerEnvironment.ServerEnvironment;
      const auth = yield* EnvironmentAuth.EnvironmentAuth;
      const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
      const serverSettings = yield* ServerSettings.ServerSettingsService;
      const startup = yield* ServerRuntimeStartup.ServerRuntimeStartup;
      const orchestration = yield* OrchestrationEngine.OrchestrationEngineService;
      const projections = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
      const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;

      const authorize = <A, E, R>(
        scope: AuthEnvironmentScope,
        effect: Effect.Effect<A, E, R>,
      ): Effect.Effect<A, E | EnvironmentAuthorizationError, R> =>
        currentSession.scopes.includes(scope) ? effect : Effect.fail(toAuthorizationError(scope));

      const loadConfig = Effect.gen(function* () {
        const settings = ServerSettings.redactServerSettingsForClient(
          yield* serverSettings.getSettings,
        );
        return {
          environment: yield* environment.getDescriptor,
          auth: yield* auth.getDescriptor(),
          cwd: config.cwd,
          keybindingsConfigPath: config.keybindingsConfigPath,
          keybindings: [],
          issues: [],
          providers: yield* providerRegistry.getProviders,
          availableEditors: [],
          observability: {
            logsDirectoryPath: config.logsDir,
            localTracingEnabled: true,
          },
          settings,
          shellResumeCompletionMarker: true,
          threadResumeCompletionMarker: true,
        } satisfies typeof ServerConfigSchema.Type;
      });

      const dispatch = (command: Parameters<typeof normalizeDispatchCommand>[0]) =>
        Effect.gen(function* () {
          const normalized = yield* normalizeDispatchCommand(command);
          const result = yield* startup.enqueueCommand(
            Effect.gen(function* () {
              if (normalized.type === "thread.turn.start" && normalized.bootstrap?.createThread) {
                const { bootstrap, ...turnStart } = normalized;
                yield* orchestration.dispatch({
                  type: "thread.create",
                  commandId: CommandId.make(`${command.commandId}:create-thread`),
                  threadId: normalized.threadId,
                  ...bootstrap.createThread,
                } as never);
                return yield* orchestration.dispatch(turnStart as never);
              }
              return yield* orchestration.dispatch(normalized);
            }),
          );
          return result;
        }).pipe(Effect.mapError(toDispatchError));

      const projectShellEvent = (event: OrchestrationEvent) =>
        projections.getProjectShellById(ProjectId.make(event.aggregateId)).pipe(
          Effect.map((project) =>
            Option.match(project, {
              onNone: () => ({
                kind: "project-removed" as const,
                sequence: event.sequence,
                projectId: ProjectId.make(event.aggregateId),
              }),
              onSome: (value) => ({
                kind: "project-upserted" as const,
                sequence: event.sequence,
                project: value,
              }),
            }),
          ),
          Effect.mapError((cause) =>
            toSnapshotError("Failed to load the local project snapshot.", cause),
          ),
        );

      const threadShellEvent = (event: OrchestrationEvent) =>
        projections.getThreadShellById(ThreadId.make(event.aggregateId)).pipe(
          Effect.map((thread) =>
            Option.match(thread, {
              onNone: () => ({
                kind: "thread-removed" as const,
                sequence: event.sequence,
                threadId: ThreadId.make(event.aggregateId),
              }),
              onSome: (value) => ({
                kind: "thread-upserted" as const,
                sequence: event.sequence,
                thread: value,
              }),
            }),
          ),
          Effect.mapError((cause) =>
            toSnapshotError("Failed to load the local thread snapshot.", cause),
          ),
        );

      const shellEvent = (event: OrchestrationEvent) => {
        if (event.aggregateKind === "project") {
          return event.type === "project.deleted"
            ? Effect.succeed({
                kind: "project-removed" as const,
                sequence: event.sequence,
                projectId: ProjectId.make(event.aggregateId),
              })
            : projectShellEvent(event);
        }
        if (event.type === "thread.deleted" || event.type === "thread.archived") {
          return Effect.succeed({
            kind: "thread-removed" as const,
            sequence: event.sequence,
            threadId: ThreadId.make(event.aggregateId),
          });
        }
        return threadShellEvent(event);
      };

      const shellStream = (input: {
        readonly afterSequence?: number;
        readonly requestCompletionMarker?: boolean;
      }) =>
        Effect.gen(function* () {
          const events =
            input.afterSequence === undefined
              ? orchestration.streamDomainEvents
              : Stream.concat(
                  orchestration.readEvents(input.afterSequence, Number.MAX_SAFE_INTEGER),
                  orchestration.streamDomainEvents,
                );
          const live = events.pipe(Stream.mapEffect((event) => shellEvent(event) as never));
          const initial =
            input.afterSequence === undefined
              ? Stream.fromEffect(
                  projections.getShellSnapshot().pipe(
                    Effect.map((snapshot) => ({ kind: "snapshot" as const, snapshot })),
                    Effect.mapError((cause) =>
                      toSnapshotError("Failed to load the local workspace snapshot.", cause),
                    ),
                  ),
                )
              : Stream.empty;
          const marker = input.requestCompletionMarker
            ? Stream.make({ kind: "synchronized" as const })
            : Stream.empty;
          return Stream.concat(Stream.concat(initial, marker), live);
        });

      const threadStream = (input: {
        readonly threadId: ThreadId;
        readonly afterSequence?: number;
        readonly requestCompletionMarker?: boolean;
      }) =>
        Effect.gen(function* () {
          const events =
            input.afterSequence === undefined
              ? orchestration.streamDomainEvents
              : Stream.concat(
                  orchestration.readEvents(input.afterSequence, Number.MAX_SAFE_INTEGER),
                  orchestration.streamDomainEvents,
                );
          const live = events.pipe(
            Stream.filter(
              (event) => event.aggregateKind === "thread" && event.aggregateId === input.threadId,
            ),
            Stream.map((event) => ({ kind: "event" as const, event: projectActivityEvent(event) })),
          );
          const initial =
            input.afterSequence === undefined
              ? Stream.fromEffect(
                  projections.getThreadDetailSnapshot(input.threadId).pipe(
                    Effect.flatMap(
                      Option.match({
                        onNone: () =>
                          Effect.fail(
                            toSnapshotError(
                              `Thread ${input.threadId} was not found.`,
                              input.threadId,
                            ),
                          ),
                        onSome: (snapshot) =>
                          Effect.succeed({
                            kind: "snapshot" as const,
                            snapshot: projectThreadDetailSnapshot(snapshot),
                          }),
                      }),
                    ),
                    Effect.mapError((cause) =>
                      Schema.is(OrchestrationGetSnapshotError)(cause)
                        ? cause
                        : toSnapshotError("Failed to load the local thread snapshot.", cause),
                    ),
                  ),
                )
              : Stream.empty;
          const marker = input.requestCompletionMarker
            ? Stream.make({ kind: "synchronized" as const })
            : Stream.empty;
          return Stream.concat(Stream.concat(initial, marker), live);
        });

      return WsRpcGroup.of({
        [WS_METHODS.serverProbe]: () => authorize("orchestration:read", Effect.succeed({})),
        [WS_METHODS.serverGetConfig]: () =>
          authorize(
            "orchestration:read",
            loadConfig.pipe(
              Effect.mapError(
                (cause) =>
                  new WsServerError({
                    message: "Failed to load local server settings.",
                    cause,
                  }),
              ),
            ),
          ),
        [WS_METHODS.projectsWriteFile]: (input) =>
          authorize(
            "orchestration:operate",
            workspaceFileSystem.writeFile(input).pipe(
              Effect.mapError(
                (cause) =>
                  new ProjectWriteFileError({
                    cwd: input.cwd,
                    relativePath: input.relativePath,
                    failure: "operation_failed",
                    cause,
                  }),
              ),
            ),
          ),
        [WS_METHODS.subscribeServerConfig]: () =>
          Stream.fromEffect(
            authorize(
              "orchestration:read",
              loadConfig.pipe(
                Effect.map((config) => ({
                  version: 1 as const,
                  type: "snapshot" as const,
                  config,
                })),
                Effect.mapError(
                  (cause) =>
                    new WsServerError({
                      message: "Failed to load local server settings.",
                      cause,
                    }),
                ),
              ),
            ),
          ),
        [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command) =>
          authorize("orchestration:operate", dispatch(command)),
        [ORCHESTRATION_WS_METHODS.subscribeShell]: (input) =>
          Stream.unwrap(
            authorize(
              "orchestration:read",
              shellStream(input).pipe(
                Effect.map((stream) =>
                  stream.pipe(
                    Stream.mapError((cause) =>
                      toSnapshotError("Failed to stream the local workspace snapshot.", cause),
                    ),
                  ),
                ),
              ),
            ),
          ) as never,
        [ORCHESTRATION_WS_METHODS.subscribeThread]: (input) =>
          Stream.unwrap(
            authorize(
              "orchestration:read",
              threadStream(input).pipe(
                Effect.map((stream) =>
                  stream.pipe(
                    Stream.mapError((cause) =>
                      toSnapshotError("Failed to stream the local thread snapshot.", cause),
                    ),
                  ),
                ),
              ),
            ),
          ) as never,
      });
    }),
  );

export const websocketRpcRouteLayer = Layer.unwrap(
  Effect.gen(function* () {
    return HttpRouter.add(
      "GET",
      "/ws",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
        const sessions = yield* SessionStore.SessionStore;
        const session = yield* serverAuth.authenticateWebSocketUpgrade(request).pipe(
          Effect.catchIf(EnvironmentAuth.isServerAuthCredentialError, (error) =>
            failEnvironmentAuthInvalid(EnvironmentAuth.serverAuthCredentialReason(error)),
          ),
          Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, (error) =>
            failEnvironmentInternal("internal_error", error),
          ),
        );
        const rpcWebSocketHttpEffect = yield* RpcServer.toHttpEffectWebsocket(WsRpcGroup, {
          disableTracing: true,
        }).pipe(
          Effect.provide(
            makeWsRpcLayer(session).pipe(Layer.provideMerge(RpcSerialization.layerJson)),
          ),
        );
        return yield* Effect.acquireUseRelease(
          sessions.markConnected(session.sessionId),
          () => rpcWebSocketHttpEffect,
          () => sessions.markDisconnected(session.sessionId),
        );
      }).pipe(
        Effect.catchTags({
          EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
          EnvironmentInternalError: HttpServerRespondable.toResponse,
        }),
      ),
    );
  }),
);
