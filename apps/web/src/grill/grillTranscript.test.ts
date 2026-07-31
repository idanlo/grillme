import { EventId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildGrillmeHandoffFilename,
  buildGrillmeMarkdown,
  deriveGrillTranscript,
} from "./grillTranscript";

function activity(input: {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  sequence: number;
}): OrchestrationThreadActivity {
  return {
    id: EventId.make(input.id),
    tone: "info",
    kind: input.kind,
    summary: input.kind,
    payload: input.payload,
    turnId: null,
    sequence: input.sequence,
    createdAt: `2026-07-31T12:00:0${input.sequence}.000Z`,
  };
}

const question = {
  id: "scope",
  header: "Scope",
  question: "Which scope should we choose?",
  options: [
    {
      label: "Focused (Recommended)",
      description: "Ship the smallest coherent version.",
    },
    {
      label: "Broad",
      description: "Include adjacent workflows.",
    },
  ],
  multiSelect: false,
};

describe("deriveGrillTranscript", () => {
  it("pairs requested questions with their resolved answers", () => {
    const transcript = deriveGrillTranscript([
      activity({
        id: "resolved",
        kind: "user-input.resolved",
        sequence: 2,
        payload: { requestId: "request-1", answers: { scope: "Focused (Recommended)" } },
      }),
      activity({
        id: "requested",
        kind: "user-input.requested",
        sequence: 1,
        payload: { requestId: "request-1", questions: [question] },
      }),
    ]);

    expect(transcript).toEqual([
      expect.objectContaining({
        requestId: "request-1",
        questionId: "scope",
        answer: "Focused (Recommended)",
      }),
    ]);
  });

  it("keeps a currently pending question as unanswered", () => {
    const transcript = deriveGrillTranscript([
      activity({
        id: "requested",
        kind: "user-input.requested",
        sequence: 1,
        payload: { requestId: "request-1", questions: [question] },
      }),
    ]);

    expect(transcript[0]?.answer).toBeNull();
  });

  it("drops requests that can no longer be answered", () => {
    const transcript = deriveGrillTranscript([
      activity({
        id: "requested",
        kind: "user-input.requested",
        sequence: 1,
        payload: { requestId: "request-1", questions: [question] },
      }),
      activity({
        id: "failed",
        kind: "provider.user-input.respond.failed",
        sequence: 2,
        payload: {
          requestId: "request-1",
          detail: "Unknown pending Codex user input request: request-1",
        },
      }),
    ]);

    expect(transcript).toEqual([]);
  });

  it("preserves custom and multi-select answers", () => {
    const multiQuestion = { ...question, id: "areas", multiSelect: true };
    const transcript = deriveGrillTranscript([
      activity({
        id: "requested",
        kind: "user-input.requested",
        sequence: 1,
        payload: { requestId: "request-1", questions: [multiQuestion] },
      }),
      activity({
        id: "resolved",
        kind: "user-input.resolved",
        sequence: 2,
        payload: { requestId: "request-1", answers: { areas: ["Web", "Server"] } },
      }),
    ]);

    expect(transcript[0]?.answer).toEqual(["Web", "Server"]);
  });
});

describe("buildGrillmeMarkdown", () => {
  it("renders the original prompt, answers, and pending questions", () => {
    const markdown = buildGrillmeMarkdown({
      prompt: "Design the onboarding flow",
      transcript: [
        {
          requestId: "request-1",
          questionId: question.id,
          header: question.header,
          question: question.question,
          options: question.options,
          answer: "Focused (Recommended)",
        },
        {
          requestId: "request-2",
          questionId: "audience",
          header: "Audience",
          question: "Who is this for?",
          options: question.options,
          answer: null,
        },
      ],
    });

    expect(markdown).toContain("# Grillme Handoff");
    expect(markdown).toContain("Design the onboarding flow");
    expect(markdown).toContain("### 1. Which scope should we choose?");
    expect(markdown).toContain("**Answer:**\n\nFocused (Recommended)");
    expect(markdown).toContain("### 2. Who is this for?");
    expect(markdown).toContain("_Unanswered_");
    expect(markdown.endsWith("\n")).toBe(true);
  });
});

it("builds a collision-resistant workspace filename", () => {
  expect(buildGrillmeHandoffFilename(new Date("2026-07-31T12:34:56.000Z"))).toBe(
    "grillme-handoff-2026-07-31T12-34-56Z.md",
  );
});
