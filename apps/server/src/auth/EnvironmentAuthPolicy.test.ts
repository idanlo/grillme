import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as EnvironmentAuthPolicy from "./EnvironmentAuthPolicy.ts";

const makeEnvironmentAuthPolicyLayer = (
  overrides?: Partial<ServerConfig.ServerConfig["Service"]>,
) =>
  EnvironmentAuthPolicy.layer.pipe(
    Layer.provide(
      Layer.effect(
        ServerConfig.ServerConfig,
        Effect.gen(function* () {
          const config = yield* ServerConfig.ServerConfig;
          return {
            ...config,
            ...overrides,
          } satisfies ServerConfig.ServerConfig["Service"];
        }),
      ).pipe(
        Layer.provide(
          ServerConfig.layerTest(process.cwd(), { prefix: "grillme-auth-policy-test-" }),
        ),
      ),
    ),
  );

it.layer(NodeServices.layer)("EnvironmentAuthPolicy.layer", (it) => {
  it.effect("advertises the local browser pairing policy", () =>
    Effect.gen(function* () {
      const policy = yield* EnvironmentAuthPolicy.EnvironmentAuthPolicy;
      const descriptor = yield* policy.getDescriptor();

      expect(descriptor).toEqual({
        policy: "loopback-browser",
        bootstrapMethods: ["one-time-token"],
        sessionMethods: ["browser-session-cookie", "bearer-access-token"],
        sessionCookieName: expect.stringMatching(/^grillme_session_3773_[a-f0-9]{12}$/),
      });
    }).pipe(
      Effect.provide(
        makeEnvironmentAuthPolicyLayer({
          mode: "web",
          host: "127.0.0.1",
          port: 3773,
        }),
      ),
    ),
  );

  it.effect("keeps the same policy for the Vite development URL", () =>
    Effect.gen(function* () {
      const policy = yield* EnvironmentAuthPolicy.EnvironmentAuthPolicy;
      const descriptor = yield* policy.getDescriptor();

      expect(descriptor.policy).toBe("loopback-browser");
      expect(descriptor.bootstrapMethods).toEqual(["one-time-token"]);
      expect(descriptor.sessionCookieName).toMatch(/^grillme_session_5775_[a-f0-9]{12}$/);
    }).pipe(
      Effect.provide(
        makeEnvironmentAuthPolicyLayer({
          mode: "web",
          host: "127.0.0.1",
          port: 5775,
          devUrl: new URL("http://127.0.0.1:5734"),
        }),
      ),
    ),
  );
});
