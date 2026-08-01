import { describe, expect, it } from "vite-plus/test";

import { deriveAuthClientMetadata, resolveSessionCookieName } from "./utils.ts";

describe("deriveAuthClientMetadata", () => {
  it("infers browser metadata from the local browser user agent", () => {
    const metadata = deriveAuthClientMetadata({
      request: {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/136.0.7103.93 Safari/537.36",
        },
        source: {
          remoteAddress: "::ffff:127.0.0.1",
        },
      } as never,
    });

    expect(metadata).toMatchObject({
      browser: "Chrome",
      deviceType: "browser",
      ipAddress: "127.0.0.1",
      os: "macOS",
    });
  });

  it("applies local browser presentation metadata without replacing transport metadata", () => {
    const metadata = deriveAuthClientMetadata({
      request: {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/136.0.7103.93 Safari/537.36",
        },
        source: {
          remoteAddress: "::ffff:192.168.213.72",
        },
      } as never,
      presented: {
        label: "Grillme browser",
        deviceType: "browser",
        os: "macOS",
      },
    });

    expect(metadata).toMatchObject({
      label: "Grillme browser",
      browser: "Chrome",
      deviceType: "browser",
      ipAddress: "192.168.213.72",
      os: "macOS",
    });
  });
});

describe("session cookie isolation", () => {
  it("isolates local servers by port and server state", () => {
    const first = resolveSessionCookieName({
      mode: "web",
      port: 5775,
      host: "127.0.0.1",
      instanceKey: "/tmp/grillme-agent-one",
      development: true,
    });
    const second = resolveSessionCookieName({
      mode: "web",
      port: 5775,
      host: "127.0.0.1",
      instanceKey: "/tmp/grillme-agent-two",
      development: true,
    });

    expect(first).toMatch(/^grillme_session_5775_[a-f0-9]{12}$/);
    expect(second).toMatch(/^grillme_session_5775_[a-f0-9]{12}$/);
    expect(first).not.toBe(second);
  });

  it("keeps parallel local servers isolated on every host binding", () => {
    expect(
      resolveSessionCookieName({
        mode: "web",
        port: 5775,
        host: "0.0.0.0",
        instanceKey: "/tmp/grillme-wildcard",
        development: true,
      }),
    ).toMatch(/^grillme_session_5775_[a-f0-9]{12}$/);
  });
});
