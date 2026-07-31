import { describe, expect, it } from "vite-plus/test";

import {
  buildGrillmeFirstTurn,
  displayGrillmeUserMessage,
  extractGrillmeUserPrompt,
  GRILLME_PROTOCOL,
} from "./protocol";

describe("Grillme protocol", () => {
  it("wraps the exact protocol and preserves the user's prompt", () => {
    const prompt = "Help me decide how authentication should work.";
    const message = buildGrillmeFirstTurn(prompt);

    expect(message).toContain(GRILLME_PROTOCOL);
    expect(message).toContain("<grillme_protocol>");
    expect(message).toContain(`<user_prompt>\n${prompt}\n</user_prompt>`);
    expect(extractGrillmeUserPrompt(message)).toBe(prompt);
  });

  it("requires one structured question and a recommended first option", () => {
    expect(GRILLME_PROTOCOL).toContain("Ask exactly one question at a time");
    expect(GRILLME_PROTOCOL).toContain("structured user-input or question tool");
    expect(GRILLME_PROTOCOL).toContain("(Recommended)");
  });

  it("shows ordinary user messages unchanged", () => {
    expect(displayGrillmeUserMessage("A regular follow-up")).toBe("A regular follow-up");
  });

  it("does not expose a malformed protocol wrapper as a partial prompt", () => {
    const malformed = "<grillme_protocol>instructions</grillme_protocol>";
    expect(extractGrillmeUserPrompt(malformed)).toBeNull();
    expect(displayGrillmeUserMessage(malformed)).toBe(malformed);
  });

  it("unwraps a provider effort prefix without exposing the protocol", () => {
    const wrapped = `Ultrathink:\n${buildGrillmeFirstTurn("Keep the prompt visible")}`;

    expect(displayGrillmeUserMessage(wrapped)).toBe("Keep the prompt visible");
  });
});
