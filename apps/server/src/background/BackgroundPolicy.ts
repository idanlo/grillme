import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/**
 * Provider maintenance used to wait for foreground-client activity and host
 * power telemetry. Grillme is a single local browser session, so maintenance
 * work can run without a native or desktop activity bridge.
 */
export class BackgroundPolicy extends Context.Service<
  BackgroundPolicy,
  {
    readonly shouldRunScopeWork: (...args: ReadonlyArray<unknown>) => Effect.Effect<boolean>;
  }
>()("grillme/background/BackgroundPolicy") {}

export const layer = Layer.succeed(
  BackgroundPolicy,
  BackgroundPolicy.of({
    shouldRunScopeWork: () => Effect.succeed(true),
  }),
);
