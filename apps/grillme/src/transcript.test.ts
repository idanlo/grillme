import type { OrchestrationThreadActivity } from "@grillme/contracts";
import { EventId, TurnId } from "@grillme/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildHandoffMarkdown,
  derivePendingApproval,
  derivePendingRequest,
  deriveTranscript,
  deriveWorkingStatus,
} from "./transcript";

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

  it("surfaces and clears provider approval requests", () => {
    const requested = activity(
      "approval.requested",
      {
        requestId: "approval-1",
        requestKind: "command",
        detail: "rg --files apps/grillme",
      },
      1,
    );
    expect(derivePendingApproval([requested])).toEqual({
      requestId: "approval-1",
      requestKind: "command",
      detail: "rg --files apps/grillme",
    });

    const resolved = activity(
      "approval.resolved",
      { requestId: "approval-1", decision: "accept" },
      2,
    );
    expect(derivePendingApproval([resolved, requested])).toBeNull();
  });

  it("uses the latest provider progress instead of a permanent generic message", () => {
    expect(
      deriveWorkingStatus([
        activity("task.progress", {}, 1),
        { ...activity("task.progress", {}, 2), summary: "Reading apps/grillme/src/App.tsx" },
        activity("context-window.updated", {}, 3),
      ]),
    ).toBe("Reading apps/grillme/src/App.tsx");
  });
});
