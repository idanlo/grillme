import { makeWsRpcProtocolClient, type WsRpcProtocolClient } from "@grillme/client-runtime/rpc";
import {
  ORCHESTRATION_WS_METHODS,
  WS_METHODS,
  type ClientOrchestrationCommand,
  type OrchestrationShellStreamItem,
  type OrchestrationThreadStreamItem,
  type ProjectWriteFileInput,
  type ServerConfig,
  type ServerConfigStreamEvent,
  type ThreadId,
} from "@grillme/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as RpcClient from "effect/unstable/rpc/RpcClient";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import * as Socket from "effect/unstable/socket/Socket";

function websocketUrl(): string {
  const url = new URL(window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  return url.toString();
}

let browserSessionBootstrap: Promise<void> | undefined;

function bootstrapBrowserSession(): Promise<void> {
  if (browserSessionBootstrap) return browserSessionBootstrap;

  browserSessionBootstrap = (async () => {
    const currentUrl = new URL(window.location.href);
    const credential = currentUrl.searchParams.get("pairingToken")?.trim() || undefined;
    const request = async (path: string, init?: RequestInit): Promise<unknown> => {
      // This is the browser-only auth boundary; the local server sets the session cookie here.
      // @effect-diagnostics-next-line globalFetch:off
      const response = await fetch(path, { ...init, credentials: "include" });
      if (!response.ok) {
        throw new Error(`Local Grillme request ${path} failed with HTTP ${response.status}.`);
      }
      return response.json();
    };

    let session = (await request("/api/auth/session")) as { authenticated: boolean };
    if (session.authenticated) return;
    if (!credential) {
      throw new Error(
        "This Grillme link is missing its local pairing token. Restart `pnpm dev` or `npx grillme` and use the URL it opens.",
      );
    }

    await request("/api/auth/browser-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credential }),
    });
    currentUrl.searchParams.delete("pairingToken");
    window.history.replaceState(
      {},
      "",
      `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
    );
    session = (await request("/api/auth/session")) as { authenticated: boolean };
    if (!session.authenticated)
      throw new Error("The local Grillme session could not be authenticated.");
  })();

  return browserSessionBootstrap;
}

function protocolLayer() {
  const socketLayer = Socket.layerWebSocket(websocketUrl(), {
    openTimeout: "15 seconds",
  }).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal));

  return Layer.effect(
    RpcClient.Protocol,
    RpcClient.makeProtocolSocket({
      retryTransientErrors: false,
      retryPolicy: Schedule.recurs(0),
    }),
  ).pipe(Layer.provide(Layer.merge(socketLayer, RpcSerialization.layerJson)));
}

export interface GrillmeRpc {
  readonly config: ServerConfig;
  readonly dispatch: (command: ClientOrchestrationCommand) => Promise<unknown>;
  readonly writeFile: (input: ProjectWriteFileInput) => Promise<{ readonly relativePath: string }>;
  readonly subscribeConfig: (
    onItem: (item: ServerConfigStreamEvent) => void,
    onError: (error: unknown) => void,
  ) => () => void;
  readonly subscribeShell: (
    onItem: (item: OrchestrationShellStreamItem) => void,
    onError: (error: unknown) => void,
  ) => () => void;
  readonly subscribeThread: (
    threadId: ThreadId,
    onItem: (item: OrchestrationThreadStreamItem) => void,
    onError: (error: unknown) => void,
  ) => () => void;
  readonly close: () => Promise<void>;
}

function subscribe<A>(
  stream: Stream.Stream<A, unknown>,
  onItem: (item: A) => void,
  onError: (error: unknown) => void,
): () => void {
  const effect = stream.pipe(
    Stream.runForEach((item) => Effect.sync(() => onItem(item))),
    Effect.catchCause((cause) => Effect.sync(() => onError(cause))),
  );
  const fiber = Effect.runFork(effect);
  return () => {
    void Effect.runPromise(Fiber.interrupt(fiber));
  };
}

export async function connectRpc(): Promise<GrillmeRpc> {
  await bootstrapBrowserSession();
  const runtime = ManagedRuntime.make(protocolLayer());
  const clientScope = await Effect.runPromise(Scope.make());
  let client: WsRpcProtocolClient;
  let config: ServerConfig;

  try {
    client = await runtime.runPromise(
      makeWsRpcProtocolClient.pipe(Effect.provideService(Scope.Scope, clientScope)),
    );
    config = await Effect.runPromise(client[WS_METHODS.serverGetConfig]({}));
  } catch (error) {
    await Effect.runPromise(Scope.close(clientScope, Exit.void));
    await runtime.dispose();
    throw error;
  }

  return {
    config,
    dispatch: (command) =>
      Effect.runPromise(client[ORCHESTRATION_WS_METHODS.dispatchCommand](command)),
    writeFile: (input) => Effect.runPromise(client[WS_METHODS.projectsWriteFile](input)),
    subscribeConfig: (onItem, onError) =>
      subscribe(client[WS_METHODS.subscribeServerConfig]({}), onItem, onError),
    subscribeShell: (onItem, onError) =>
      subscribe(
        client[ORCHESTRATION_WS_METHODS.subscribeShell]({ requestCompletionMarker: true }),
        onItem,
        onError,
      ),
    subscribeThread: (threadId, onItem, onError) =>
      subscribe(
        client[ORCHESTRATION_WS_METHODS.subscribeThread]({
          threadId,
          requestCompletionMarker: true,
        }),
        onItem,
        onError,
      ),
    close: async () => {
      await Effect.runPromise(Scope.close(clientScope, Exit.void));
      await runtime.dispose();
    },
  };
}
