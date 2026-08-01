import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { EnvironmentAuthorizationError } from "./auth.ts";
import {
  ClientOrchestrationCommand,
  ORCHESTRATION_WS_METHODS,
  OrchestrationDispatchCommandError,
  OrchestrationGetSnapshotError,
  OrchestrationRpcSchemas,
} from "./orchestration.ts";
import { ProjectWriteFileError, ProjectWriteFileInput, ProjectWriteFileResult } from "./project.ts";
import { ServerConfig, ServerConfigStreamEvent } from "./server.ts";

/** The intentionally small local WebSocket surface used by Grillme. */
export const WS_METHODS = {
  serverProbe: "server.probe",
  serverGetConfig: "server.getConfig",
  projectsWriteFile: "projects.writeFile",
  subscribeServerConfig: "subscribeServerConfig",
} as const;

export class WsServerError extends Schema.TaggedErrorClass<WsServerError>()("WsServerError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export const WsServerProbeRpc = Rpc.make(WS_METHODS.serverProbe, {
  payload: Schema.Struct({}),
  success: Schema.Struct({}),
  error: EnvironmentAuthorizationError,
});

export const WsServerGetConfigRpc = Rpc.make(WS_METHODS.serverGetConfig, {
  payload: Schema.Struct({}),
  success: ServerConfig,
  error: Schema.Union([EnvironmentAuthorizationError, WsServerError]),
});

export const WsProjectsWriteFileRpc = Rpc.make(WS_METHODS.projectsWriteFile, {
  payload: ProjectWriteFileInput,
  success: ProjectWriteFileResult,
  error: Schema.Union([ProjectWriteFileError, EnvironmentAuthorizationError, WsServerError]),
});

export const WsSubscribeServerConfigRpc = Rpc.make(WS_METHODS.subscribeServerConfig, {
  payload: Schema.Struct({}),
  success: ServerConfigStreamEvent,
  error: Schema.Union([EnvironmentAuthorizationError, WsServerError]),
  stream: true,
});

export const WsOrchestrationDispatchCommandRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.dispatchCommand,
  {
    payload: ClientOrchestrationCommand,
    success: OrchestrationRpcSchemas.dispatchCommand.output,
    error: Schema.Union([
      OrchestrationDispatchCommandError,
      EnvironmentAuthorizationError,
      WsServerError,
    ]),
  },
);

export const WsOrchestrationSubscribeShellRpc = Rpc.make(ORCHESTRATION_WS_METHODS.subscribeShell, {
  payload: OrchestrationRpcSchemas.subscribeShell.input,
  success: OrchestrationRpcSchemas.subscribeShell.output,
  error: Schema.Union([
    OrchestrationGetSnapshotError,
    EnvironmentAuthorizationError,
    WsServerError,
  ]),
  stream: true,
});

export const WsOrchestrationSubscribeThreadRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.subscribeThread,
  {
    payload: OrchestrationRpcSchemas.subscribeThread.input,
    success: OrchestrationRpcSchemas.subscribeThread.output,
    error: Schema.Union([
      OrchestrationGetSnapshotError,
      EnvironmentAuthorizationError,
      WsServerError,
    ]),
    stream: true,
  },
);

export const WsRpcGroup = RpcGroup.make(
  WsServerProbeRpc,
  WsServerGetConfigRpc,
  WsProjectsWriteFileRpc,
  WsSubscribeServerConfigRpc,
  WsOrchestrationDispatchCommandRpc,
  WsOrchestrationSubscribeShellRpc,
  WsOrchestrationSubscribeThreadRpc,
);
