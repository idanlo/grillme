import type { OrchestrationThreadActivity, UserInputQuestion } from "@grillme/contracts";

export interface GrillAnswer {
  requestId: string;
  question: UserInputQuestion;
  answer: string | ReadonlyArray<string> | null;
  askedAt: string;
}

export interface PendingQuestionRequest {
  requestId: string;
  questions: ReadonlyArray<UserInputQuestion>;
}

function orderedActivities(activities: ReadonlyArray<OrchestrationThreadActivity>) {
  return [...activities].toSorted((left, right) => {
    const sequence =
      (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER);
    return (
      sequence || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
    );
  });
}

function payloadOf(activity: OrchestrationThreadActivity): Record<string, unknown> | null {
  return activity.payload && typeof activity.payload === "object"
    ? (activity.payload as Record<string, unknown>)
    : null;
}

function parseQuestions(payload: Record<string, unknown> | null): ReadonlyArray<UserInputQuestion> {
  if (!Array.isArray(payload?.questions)) return [];

  return payload.questions.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const question = entry as Record<string, unknown>;
    if (
      typeof question.id !== "string" ||
      typeof question.header !== "string" ||
      typeof question.question !== "string" ||
      !Array.isArray(question.options)
    ) {
      return [];
    }
    const options = question.options.flatMap((option) => {
      if (!option || typeof option !== "object") return [];
      const value = option as Record<string, unknown>;
      return typeof value.label === "string" && typeof value.description === "string"
        ? [{ label: value.label, description: value.description }]
        : [];
    });
    return options.length > 0
      ? [
          {
            id: question.id,
            header: question.header,
            question: question.question,
            options,
            multiSelect: question.multiSelect === true,
          },
        ]
      : [];
  });
}

function normalizeAnswer(value: unknown): string | ReadonlyArray<string> | null {
  if (typeof value === "string") return value.trim() || null;
  if (!Array.isArray(value)) return null;
  const answers = value.filter((entry): entry is string => typeof entry === "string");
  return answers.length > 0 ? answers : null;
}

export function deriveTranscript(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ReadonlyArray<GrillAnswer> {
  const entries: GrillAnswer[] = [];
  const indexesByRequest = new Map<string, ReadonlyArray<number>>();

  for (const activity of orderedActivities(activities)) {
    const payload = payloadOf(activity);
    const requestId = typeof payload?.requestId === "string" ? payload.requestId : null;
    if (!requestId) continue;

    if (activity.kind === "user-input.requested") {
      const questions = parseQuestions(payload);
      const indexes = questions.map((question) => {
        entries.push({
          requestId,
          question,
          answer: null,
          askedAt: activity.createdAt,
        });
        return entries.length - 1;
      });
      indexesByRequest.set(requestId, indexes);
    }

    if (activity.kind === "user-input.resolved") {
      const answers =
        payload?.answers && typeof payload.answers === "object"
          ? (payload.answers as Record<string, unknown>)
          : {};
      for (const index of indexesByRequest.get(requestId) ?? []) {
        const entry = entries[index];
        if (entry)
          entries[index] = {
            ...entry,
            answer: normalizeAnswer(answers[entry.question.id]),
          };
      }
      indexesByRequest.delete(requestId);
    }
  }

  return entries;
}

export function derivePendingRequest(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): PendingQuestionRequest | null {
  const pending = new Map<string, PendingQuestionRequest>();
  for (const activity of orderedActivities(activities)) {
    const payload = payloadOf(activity);
    const requestId = typeof payload?.requestId === "string" ? payload.requestId : null;
    if (!requestId) continue;
    if (activity.kind === "user-input.requested") {
      const questions = parseQuestions(payload);
      if (questions.length > 0) pending.set(requestId, { requestId, questions });
    }
    if (activity.kind === "user-input.resolved") pending.delete(requestId);
  }
  return pending.values().next().value ?? null;
}

function answerMarkdown(answer: GrillAnswer["answer"]): string {
  if (answer === null) return "_Unanswered_";
  return typeof answer === "string" ? answer : answer.map((entry) => `- ${entry}`).join("\n");
}

function planTitle(prompt: string): string {
  const first = prompt.trim().split("\n")[0]?.trim() ?? "";
  if (!first) return "Untitled plan";
  return first.length > 72 ? `${first.slice(0, 71).trimEnd()}…` : first;
}

export function buildHandoffMarkdown(input: {
  prompt: string;
  transcript: ReadonlyArray<GrillAnswer>;
}): string {
  const answered = input.transcript.filter((entry) => entry.answer !== null);
  const open = input.transcript.filter((entry) => entry.answer === null);

  const lines = [
    `# Plan: ${planTitle(input.prompt)}`,
    "",
    "## Objective",
    "",
    input.prompt.trim() || "_No objective captured yet._",
    "",
    "## Decisions",
  ];

  if (answered.length === 0) {
    lines.push("", "_Nothing locked in yet._");
  }
  answered.forEach((entry, index) => {
    lines.push(
      "",
      `### ${index + 1}. ${entry.question.question.replaceAll(/\s+/g, " ").trim()}`,
      "",
      answerMarkdown(entry.answer),
    );
  });

  if (open.length > 0) {
    lines.push("", "## Still open", "");
    for (const entry of open) {
      lines.push(`- ${entry.question.question.replaceAll(/\s+/g, " ").trim()}`);
    }
  }

  lines.push(
    "",
    "## Handoff",
    "",
    "Implement the objective above. Every decision here was made by a human — treat them as",
    "constraints, not suggestions. Ask again before changing one.",
  );

  return `${lines.join("\n")}\n`;
}

export function handoffFilename(date = new Date()): string {
  const stamp = date.toISOString().slice(0, 16).replaceAll(":", "-");
  return `grillme-plan-${stamp}.md`;
}
