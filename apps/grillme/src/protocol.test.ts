import { GRILLME_SYSTEM_PROMPT } from "@grillme/shared/grillme";
import { describe, expect, it } from "vite-plus/test";

import { buildFirstTurn, displayUserMessage } from "./protocol";

describe("Grillme protocol", () => {
  it("wraps the product rules and keeps the user's prompt recoverable", () => {
    const message = buildFirstTurn("Design a safer deploy flow");
    expect(message).toContain(GRILLME_SYSTEM_PROMPT);
    expect(displayUserMessage(message)).toBe("Design a safer deploy flow");
  });

  it("leaves ordinary follow-up messages intact", () => {
    expect(displayUserMessage("Use the second option")).toBe("Use the second option");
  });
});
