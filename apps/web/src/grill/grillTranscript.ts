import type { OrchestrationThreadActivity, UserInputQuestion } from "@t3tools/contracts";

import {
  compareActivitiesByOrder,
  isStalePendingRequestFailureDetail,
  parseUserInputQuestions,
} from "../session-logic";

export interface GrillQuestionAnswer {
  requestId: string;
  questionId: string;
  header: string;
  question: string;
  options: UserInputQuestion["options"];
  answer: string | string[] | null;
}

interface PendingRequest {
  indexes: number[];
  questions: ReadonlyArray<UserInputQuestion>;
}

function activityPayload(activity: OrchestrationThreadActivity): Record<string, unknown> | null {
  return activity.payload && typeof activity.payload === "object"
    ? (activity.payload as Record<string, unknown>)
    : null;
}

function activityRequestId(payload: Record<string, unknown> | null): string | null {
  return typeof payload?.requestId === "string" ? payload.requestId : null;
}

function normalizeAnswer(value: unknown): string | string[] | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value)) {
    const values = value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return values.length > 0 ? values : null;
  }
  return null;
}

export function deriveGrillTranscript(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): GrillQuestionAnswer[] {
  const entries: Array<GrillQuestionAnswer | null> = [];
  const pendingByRequestId = new Map<string, PendingRequest>();

  for (const activity of [...activities].toSorted(compareActivitiesByOrder)) {
    const payload = activityPayload(activity);
    const requestId = activityRequestId(payload);
    if (!requestId) continue;

    if (activity.kind === "user-input.requested") {
      const questions = parseUserInputQuestions(payload);
      if (!questions) continue;

      const indexes = questions.map((question) => {
        const index = entries.length;
        entries.push({
          requestId,
          questionId: question.id,
          header: question.header,
          question: question.question,
          options: question.options,
          answer: null,
        });
        return index;
      });
      pendingByRequestId.set(requestId, { indexes, questions });
      continue;
    }

    if (activity.kind === "user-input.resolved") {
      const pending = pendingByRequestId.get(requestId);
      const answers =
        payload?.answers && typeof payload.answers === "object"
          ? (payload.answers as Record<string, unknown>)
          : null;
      if (!pending || !answers) continue;

      pending.questions.forEach((question, questionIndex) => {
        const entryIndex = pending.indexes[questionIndex];
        if (entryIndex === undefined) return;
        const entry = entries[entryIndex];
        if (entry) {
          entries[entryIndex] = {
            ...entry,
            answer: normalizeAnswer(answers[question.id]),
          };
        }
      });
      pendingByRequestId.delete(requestId);
      continue;
    }

    if (activity.kind === "provider.user-input.respond.failed") {
      const pending = pendingByRequestId.get(requestId);
      const detail = typeof payload?.detail === "string" ? payload.detail : undefined;
      if (!pending || !isStalePendingRequestFailureDetail(detail)) continue;
      for (const index of pending.indexes) {
        entries[index] = null;
      }
      pendingByRequestId.delete(requestId);
    }
  }

  return entries.filter((entry): entry is GrillQuestionAnswer => entry !== null);
}

function headingText(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

function answerMarkdown(answer: GrillQuestionAnswer["answer"]): string {
  if (answer === null) return "_Unanswered_";
  if (Array.isArray(answer)) {
    return answer.map((entry) => `- ${entry}`).join("\n");
  }
  return answer;
}

export function buildGrillmeMarkdown(input: {
  prompt: string;
  transcript: ReadonlyArray<GrillQuestionAnswer>;
}): string {
  const sections = ["# Grillme Handoff", "## Prompt", input.prompt.trim()];

  sections.push("## Questions and answers");
  if (input.transcript.length === 0) {
    sections.push("_No questions have been recorded yet._");
  } else {
    input.transcript.forEach((entry, index) => {
      sections.push(
        `### ${index + 1}. ${headingText(entry.question)}`,
        `**Answer:**\n\n${answerMarkdown(entry.answer)}`,
      );
    });
  }

  return `${sections.join("\n\n")}\n`;
}

export function buildGrillmeHandoffFilename(date = new Date()): string {
  return `grillme-handoff-${date.toISOString().replaceAll(":", "-").replace(".000", "")}.md`;
}
