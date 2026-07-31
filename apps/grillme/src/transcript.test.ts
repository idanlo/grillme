import type { OrchestrationThreadActivity } from "@grillme/contracts";
import { EventId, TurnId } from "@grillme/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildHandoffMarkdown, derivePendingRequest, deriveTranscript } from "./transcript";

const activity = (
  kind: string,
  payload: Record<string, unknown>,
  sequence: number,
): OrchestrationThreadActivity => ({
  id: EventId.make(`event-${sequence}`),
  tone: "approval",
  kind,
  summary: kind,
  payload,
  turnId: TurnId.make("turn-1"),
  sequence,
  createdAt: `2026-07-31T10:00:0${sequence}.000Z`,
});

describe("Grillme transcript", () => {
  it("tracks a structured decision from request through resolution", () => {
    const requested = activity(
      "user-input.requested",
      {
        requestId: "request-1",
        questions: [
          {
            id: "scope",
            header: "Scope",
            question: "Where should this run?",
            options: [{ label: "Local (Recommended)", description: "Keep data on the machine." }],
          },
        ],
      },
      1,
    );
    expect(derivePendingRequest([requested])?.questions[0]?.header).toBe("Scope");

    const resolved = activity(
      "user-input.resolved",
      {
        requestId: "request-1",
        answers: { scope: "Local (Recommended)" },
      },
      2,
    );
    const transcript = deriveTranscript([resolved, requested]);
    expect(transcript[0]?.answer).toBe("Local (Recommended)");
    expect(buildHandoffMarkdown({ prompt: "Build it", transcript })).toContain(
      "### 1. Where should this run?",
    );
  });
});
