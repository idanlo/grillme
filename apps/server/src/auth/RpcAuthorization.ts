import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  ORCHESTRATION_WS_METHODS,
  type AuthEnvironmentScope,
  WS_METHODS,
  WsRpcGroup,
} from "@grillme/contracts";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";

type WsRpcMethod = RpcGroup.Rpcs<typeof WsRpcGroup>["_tag"];

export const RPC_REQUIRED_SCOPES = {
  [ORCHESTRATION_WS_METHODS.dispatchCommand]: AuthOrchestrationOperateScope,
  [ORCHESTRATION_WS_METHODS.subscribeShell]: AuthOrchestrationReadScope,
  [ORCHESTRATION_WS_METHODS.subscribeThread]: AuthOrchestrationReadScope,
  [WS_METHODS.serverProbe]: AuthOrchestrationReadScope,
  [WS_METHODS.serverGetConfig]: AuthOrchestrationReadScope,
  [WS_METHODS.projectsWriteFile]: AuthOrchestrationOperateScope,
  [WS_METHODS.subscribeServerConfig]: AuthOrchestrationReadScope,
} as const satisfies Readonly<Record<WsRpcMethod, AuthEnvironmentScope>>;

export function requiredScopeForRpcMethod(method: string): AuthEnvironmentScope {
  const requiredScope = RPC_REQUIRED_SCOPES[method as WsRpcMethod];
  if (requiredScope === undefined) {
    throw new Error(`RPC method ${method} has no declared authorization scope.`);
  }
  return requiredScope;
}
