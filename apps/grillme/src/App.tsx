import { applyThreadDetailEvent } from "@grillme/client-runtime/state/threadReducer";
import {
  CommandId,
  ApprovalRequestId,
  MessageId,
  ProjectId,
  ThreadId,
  type ClientOrchestrationCommand,
  type ModelSelection,
  type OrchestrationProjectShell,
  type OrchestrationThread,
  type ProviderApprovalDecision,
  type ServerConfig,
  type ServerConfigStreamEvent,
} from "@grillme/contracts";
import { ChevronRightIcon, InfoIcon, SquarePenIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Approval } from "@/components/approval";
import { Composer } from "@/components/composer";
import { DetailsSheet } from "@/components/details-sheet";
import { OPTION_KEYS, Question } from "@/components/question";
import { Sigil } from "@/components/sigil";
import { ChatBubble, DayDivider, SystemNote, TypingBubble } from "@/components/thread";
import { Marker, MarkerContent } from "@/components/ui/marker";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { buildFirstTurn, displayUserMessage } from "./protocol";
import { connectRpc, type GrillmeRpc } from "./rpc";
import {
  buildHandoffMarkdown,
  derivePendingApproval,
  derivePendingRequest,
  deriveTranscript,
  deriveWorkingStatus,
  handoffFilename,
  type GrillAnswer,
} from "./transcript";

type ConnectionState = "connecting" | "ready" | "error";

interface ModelChoice {
  key: string;
  providerName: string;
  modelName: string;
  selection: ModelSelection;
}

/** One bubble in the thread, already resolved to a side. */
interface Row {
  key: string;
  side: "start" | "end";
  text: string;
  at: string;
  streaming: boolean;
  divider: string | null;
}

function id<T>(schema: { readonly make: (value: string) => T }): T {
  // This is an imperative browser boundary; ids are passed into the Effect-backed RPC layer.
  // @effect-diagnostics-next-line cryptoRandomUUID:off
  return schema.make(crypto.randomUUID());
}

function now(): string {
  return new Date().toISOString();
}

function formatError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return "The local grillme server could not be reached.";
}

function shortPath(path: string | null): string {
  if (!path) return "no workspace";
  const parts = path.split("/").filter(Boolean);
  return parts.length <= 2 ? `/${parts.join("/")}` : `…/${parts.slice(-2).join("/")}`;
}

function clockTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function answerText(answer: GrillAnswer["answer"]): string {
  if (answer === null) return "";
  return typeof answer === "string" ? answer : answer.join(", ");
}

function modelChoices(config: ServerConfig | null): ReadonlyArray<ModelChoice> {
  if (!config) return [];
  return config.providers.flatMap((provider) => {
    if (!provider.enabled || !provider.installed || provider.availability === "unavailable")
      return [];
    const providerName = provider.displayName ?? provider.driver;
    return provider.models.map((model) => ({
      key: JSON.stringify([provider.instanceId, model.slug]),
      providerName,
      modelName: model.shortName ?? model.name,
      selection: { instanceId: provider.instanceId, model: model.slug },
    }));
  });
}

function applyServerConfigEvent(
  current: ServerConfig | null,
  event: ServerConfigStreamEvent,
): ServerConfig | null {
  if (event.type === "snapshot") return event.config;
  if (!current) return current;

  switch (event.type) {
    case "keybindingsUpdated":
      return {
        ...current,
        keybindings: event.payload.keybindings,
        issues: event.payload.issues,
      };
    case "providerStatuses":
      return { ...current, providers: event.payload.providers };
    case "settingsUpdated":
      return { ...current, settings: event.payload.settings };
  }
}

/* ── nav bar ────────────────────────────────────────────────────────────── */

function NavBar({
  subtitle,
  showNew,
  onNewGrill,
  onOpenDetails,
}: {
  readonly subtitle: string;
  readonly showNew: boolean;
  readonly onNewGrill: () => void;
  readonly onOpenDetails: () => void;
}) {
  return (
    <header className="chrome-bar hairline-b relative z-10 flex items-center justify-center pt-[max(0.5rem,env(safe-area-inset-top))] pb-1.5">
      <div className="absolute left-2 flex items-center">
        {showNew ? (
          <button
            type="button"
            aria-label="Start a new grill"
            onClick={onNewGrill}
            className="pressable flex size-9 items-center justify-center rounded-full text-tint transition-colors hover:bg-muted"
          >
            <SquarePenIcon className="size-[22px]" strokeWidth={1.75} />
          </button>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onOpenDetails}
        className="pressable flex flex-col items-center gap-1 rounded-lg px-3 py-0.5"
      >
        <Sigil className="size-[30px]" />
        <span className="flex items-center gap-0.5 text-[11px] leading-[13px] tracking-[-0.01em]">
          grillme
          <ChevronRightIcon className="size-2.5 text-muted-foreground" strokeWidth={2.5} />
        </span>
        <span className="sr-only">Open details</span>
      </button>

      <div className="absolute right-2 flex items-center">
        <button
          type="button"
          aria-label="Details"
          onClick={onOpenDetails}
          className="pressable flex size-9 items-center justify-center rounded-full text-tint transition-colors hover:bg-muted"
        >
          <InfoIcon className="size-[22px]" strokeWidth={1.75} />
        </button>
      </div>

      <span className="sr-only">{subtitle}</span>
    </header>
  );
}

/* ── app ────────────────────────────────────────────────────────────────── */

export function App() {
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [rpc, setRpc] = useState<GrillmeRpc | null>(null);
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [projects, setProjects] = useState<ReadonlyArray<OrchestrationProjectShell>>([]);
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] = useState("");
  const [selectedModelKey, setSelectedModelKey] = useState("");
  const [threadId, setThreadId] = useState<ThreadId | null>(null);
  const [thread, setThread] = useState<OrchestrationThread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [approving, setApproving] = useState(false);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [draftAnswers, setDraftAnswers] = useState<Record<string, string | ReadonlyArray<string>>>(
    {},
  );
  const [selectedOptions, setSelectedOptions] = useState<ReadonlyArray<string>>([]);
  const [planStatus, setPlanStatus] = useState<string | null>(null);
  const [planFile] = useState(() => handoffFilename());
  const [detailsOpen, setDetailsOpen] = useState(false);

  const choices = useMemo(() => modelChoices(config), [config]);
  const selectedChoice = useMemo(
    () => choices.find((choice) => choice.key === selectedModelKey) ?? null,
    [choices, selectedModelKey],
  );
  const transcript = useMemo(
    () => deriveTranscript(thread?.activities ?? []),
    [thread?.activities],
  );
  const pendingRequest = useMemo(
    () => derivePendingRequest(thread?.activities ?? []),
    [thread?.activities],
  );
  const pendingApproval = useMemo(
    () => derivePendingApproval(thread?.activities ?? []),
    [thread?.activities],
  );
  const workingStatus = useMemo(
    () => deriveWorkingStatus(thread?.activities ?? []),
    [thread?.activities],
  );
  const activeQuestion = pendingRequest?.questions[questionIndex] ?? null;
  const running = Boolean(threadId) && (!thread || thread.session?.status === "running");

  // Every answered question becomes the pair it always was in the interview:
  // the question they were asked, then the answer they gave.
  const rows = useMemo<ReadonlyArray<Row>>(() => {
    const items: Row[] = [];
    for (const message of thread?.messages ?? []) {
      const text = message.role === "user" ? displayUserMessage(message.text) : message.text;
      if (!text.trim()) continue;
      if (message.role !== "user" && message.role !== "assistant") continue;
      items.push({
        key: message.id,
        side: message.role === "user" ? "end" : "start",
        text: text.trim(),
        at: message.createdAt,
        streaming: message.streaming,
        divider: null,
      });
    }
    for (const entry of transcript) {
      if (entry.answer === null) continue;
      const base = `${entry.requestId}:${entry.question.id}`;
      items.push({
        key: `${base}:q`,
        side: "start",
        text: entry.question.question,
        at: entry.askedAt,
        streaming: false,
        divider: entry.question.header,
      });
      items.push({
        key: `${base}:a`,
        side: "end",
        text: answerText(entry.answer),
        at: `${entry.askedAt}~`,
        streaming: false,
        divider: null,
      });
    }
    return items.toSorted((left, right) => left.at.localeCompare(right.at));
  }, [thread?.messages, transcript]);

  const planMarkdown = useMemo(
    () => buildHandoffMarkdown({ prompt, transcript }),
    [prompt, transcript],
  );

  useEffect(() => {
    let active = true;
    let unsubscribeConfig: (() => void) | undefined;
    let unsubscribeShell: (() => void) | undefined;
    let liveRpc: GrillmeRpc | undefined;

    void connectRpc()
      .then((nextRpc) => {
        if (!active) {
          void nextRpc.close();
          return;
        }
        liveRpc = nextRpc;
        setRpc(nextRpc);
        setConfig(nextRpc.config);
        unsubscribeConfig = nextRpc.subscribeConfig(
          (event) => setConfig((current) => applyServerConfigEvent(current, event)),
          (cause) => setError(formatError(cause)),
        );
        unsubscribeShell = nextRpc.subscribeShell(
          (item) => {
            if (item.kind === "snapshot") {
              setProjects(item.snapshot.projects);
              setConnection("ready");
            }
            if (item.kind === "synchronized") setConnection("ready");
            if (item.kind === "project-upserted") {
              setProjects((current) => [
                ...current.filter((project) => project.id !== item.project.id),
                item.project,
              ]);
            }
            if (item.kind === "project-removed") {
              setProjects((current) => current.filter((project) => project.id !== item.projectId));
            }
          },
          (cause) => setError(formatError(cause)),
        );
      })
      .catch((cause) => {
        if (!active) return;
        setConnection("error");
        setError(formatError(cause));
      });

    return () => {
      active = false;
      unsubscribeConfig?.();
      unsubscribeShell?.();
      if (liveRpc) void liveRpc.close();
    };
  }, []);

  useEffect(() => {
    if (!selectedModelKey && choices[0]) setSelectedModelKey(choices[0].key);
  }, [choices, selectedModelKey]);

  useEffect(() => {
    if (!rpc || !threadId) return;
    setThread(null);
    return rpc.subscribeThread(
      threadId,
      (item) => {
        if (item.kind === "snapshot") {
          setThread(item.snapshot.thread);
          return;
        }
        if (item.kind === "event") {
          setThread((current) => {
            if (!current) return current;
            const result = applyThreadDetailEvent(current, item.event);
            return result.kind === "updated"
              ? result.thread
              : result.kind === "deleted"
                ? null
                : current;
          });
        }
      },
      (cause) => setError(formatError(cause)),
    );
  }, [rpc, threadId]);

  useEffect(() => {
    setQuestionIndex(0);
    setDraftAnswers({});
    setSelectedOptions([]);
  }, [pendingRequest?.requestId]);

  const startGrill = useCallback(
    (text: string) => {
      if (!rpc || !config || !selectedChoice || !text.trim() || starting) return;
      setStarting(true);
      setPrompt(text.trim());
      setError(null);
      const run = async () => {
        let project = projects.find((entry) => entry.workspaceRoot === config.cwd) ?? projects[0];
        if (!project) {
          const projectId = id(ProjectId);
          await rpc.dispatch({
            type: "project.create",
            commandId: id(CommandId),
            projectId,
            title: config.cwd.split("/").filter(Boolean).at(-1) ?? "Workspace",
            workspaceRoot: config.cwd,
            defaultModelSelection: selectedChoice.selection,
            createdAt: now(),
          });
          project = {
            id: projectId,
            title: "Workspace",
            workspaceRoot: config.cwd,
            defaultModelSelection: selectedChoice.selection,
            scripts: [],
            createdAt: now(),
            updatedAt: now(),
          };
        }

        const nextThreadId = id(ThreadId);
        const createdAt = now();
        const command: ClientOrchestrationCommand = {
          type: "thread.turn.start",
          commandId: id(CommandId),
          threadId: nextThreadId,
          message: {
            messageId: id(MessageId),
            role: "user",
            text: buildFirstTurn(text),
            attachments: [],
          },
          modelSelection: selectedChoice.selection,
          titleSeed: text.slice(0, 80),
          runtimeMode: "approval-required",
          interactionMode: "plan",
          bootstrap: {
            createThread: {
              projectId: project.id,
              title: text.slice(0, 80),
              modelSelection: selectedChoice.selection,
              runtimeMode: "approval-required",
              interactionMode: "plan",
              branch: null,
              worktreePath: null,
              createdAt,
            },
          },
          createdAt,
        };
        await rpc.dispatch(command);
        setThreadId(nextThreadId);
      };
      void run()
        .catch((cause) => setError(formatError(cause)))
        .finally(() => setStarting(false));
    },
    [config, projects, rpc, selectedChoice, starting],
  );

  const sendFollowup = useCallback(
    (text: string) => {
      if (!rpc || !threadId || !text.trim() || !selectedChoice) return;
      void rpc
        .dispatch({
          type: "thread.turn.start",
          commandId: id(CommandId),
          threadId,
          message: {
            messageId: id(MessageId),
            role: "user",
            text: text.trim(),
            attachments: [],
          },
          modelSelection: selectedChoice.selection,
          runtimeMode: "approval-required",
          interactionMode: "plan",
          createdAt: now(),
        })
        .catch((cause) => setError(formatError(cause)));
    },
    [rpc, selectedChoice, threadId],
  );

  const submitAnswer = useCallback(
    (freeform?: string) => {
      if (!rpc || !threadId || !pendingRequest || !activeQuestion || answering) return;
      const written = freeform?.trim() ?? "";
      const answer = written || (activeQuestion.multiSelect ? selectedOptions : selectedOptions[0]);
      if (!answer || (Array.isArray(answer) && answer.length === 0)) return;
      const nextAnswers = { ...draftAnswers, [activeQuestion.id]: answer };
      setSelectedOptions([]);
      if (questionIndex + 1 < pendingRequest.questions.length) {
        setDraftAnswers(nextAnswers);
        setQuestionIndex((current) => current + 1);
        return;
      }

      setAnswering(true);
      void rpc
        .dispatch({
          type: "thread.user-input.respond",
          commandId: id(CommandId),
          threadId,
          requestId: ApprovalRequestId.make(pendingRequest.requestId),
          answers: nextAnswers,
          createdAt: now(),
        })
        .catch((cause) => setError(formatError(cause)))
        .finally(() => setAnswering(false));
    },
    [
      activeQuestion,
      answering,
      draftAnswers,
      pendingRequest,
      questionIndex,
      rpc,
      selectedOptions,
      threadId,
    ],
  );

  const respondToApproval = useCallback(
    (decision: ProviderApprovalDecision) => {
      if (!rpc || !threadId || !pendingApproval || approving) return;
      setApproving(true);
      void rpc
        .dispatch({
          type: "thread.approval.respond",
          commandId: id(CommandId),
          threadId,
          requestId: ApprovalRequestId.make(pendingApproval.requestId),
          decision,
          createdAt: now(),
        })
        .catch((cause) => setError(formatError(cause)))
        .finally(() => setApproving(false));
    },
    [approving, pendingApproval, rpc, threadId],
  );

  const toggleOption = useCallback(
    (label: string) => {
      if (!activeQuestion) return;
      setSelectedOptions((current) =>
        activeQuestion.multiSelect
          ? current.includes(label)
            ? current.filter((entry) => entry !== label)
            : [...current, label]
          : [label],
      );
    },
    [activeQuestion],
  );

  // Single-select picks are a keyboard-speed action: commit them straight away
  // instead of asking for a second confirming click.
  const pickOption = useCallback(
    (label: string) => {
      if (!activeQuestion) return;
      if (activeQuestion.multiSelect) {
        toggleOption(label);
        return;
      }
      setSelectedOptions([label]);
      submitAnswer(label);
    },
    [activeQuestion, submitAnswer, toggleOption],
  );

  useEffect(() => {
    if (!activeQuestion) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;
      const index = OPTION_KEYS.indexOf(event.key.toUpperCase());
      const option = index >= 0 ? activeQuestion.options[index] : undefined;
      if (!option) return;
      event.preventDefault();
      pickOption(option.label);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeQuestion, pickOption]);

  const submitComposer = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    if (!threadId) {
      startGrill(text);
      return;
    }
    if (activeQuestion) {
      submitAnswer(text);
      return;
    }
    sendFollowup(text);
  }, [activeQuestion, draft, sendFollowup, startGrill, submitAnswer, threadId]);

  const writePlan = useCallback(() => {
    if (!rpc || !config || !thread) return;
    setPlanStatus("Saving…");
    void rpc
      .writeFile({
        cwd: config.cwd,
        relativePath: planFile,
        contents: planMarkdown,
      })
      .then((result) => setPlanStatus(`Saved ${result.relativePath}`))
      .catch((cause) => {
        setPlanStatus(null);
        setError(formatError(cause));
      });
  }, [config, planFile, planMarkdown, rpc, thread]);

  const reset = useCallback(() => {
    setThreadId(null);
    setThread(null);
    setPrompt("");
    setDraft("");
    setError(null);
    setPlanStatus(null);
  }, []);

  const placeholder = !threadId
    ? "What are we pressure-testing?"
    : activeQuestion
      ? "Answer in your own words"
      : "Message";

  const busy = starting || running;
  // Whatever trails the thread decides whether the last bubble keeps its tail.
  const trailingSide: "start" | "end" | null =
    activeQuestion || pendingApproval || busy ? "start" : null;
  const lastRow = rows.at(-1);
  const openedAt = rows[0]?.at ?? now();

  return (
    <div className="stage">
      <div className="phone">
        <NavBar
          subtitle={shortPath(config?.cwd ?? null)}
          showNew={Boolean(threadId)}
          onNewGrill={reset}
          onOpenDetails={() => setDetailsOpen(true)}
        />

        <MessageScrollerProvider autoScroll>
          <MessageScroller>
            {/* Messages has no visible scrollbar; the thread is the only surface. */}
            <MessageScrollerViewport className="overflow-x-hidden">
              <MessageScrollerContent className="gap-2 px-3.5 py-4">
                <MessageScrollerItem messageId="intro">
                  <div className="flex flex-col gap-3 pb-2">
                    <DayDivider label="Today" time={clockTime(openedAt)} />
                    <SystemNote>
                      grillme asks one hard question at a time until the plan has no blanks. It
                      reads your repository to check facts. It never writes to it.
                    </SystemNote>
                  </div>
                </MessageScrollerItem>

                {rows.map((row, index) => {
                  const next = rows[index + 1];
                  const nextSide = next ? next.side : trailingSide;
                  return (
                    <MessageScrollerItem
                      key={row.key}
                      messageId={row.key}
                      scrollAnchor={row.side === "end"}
                    >
                      {row.divider ? (
                        <Marker variant="separator" className="mt-2 mb-2 px-4">
                          <MarkerContent className="text-[11px] font-medium text-muted-foreground">
                            {row.divider}
                          </MarkerContent>
                        </Marker>
                      ) : null}
                      <ChatBubble
                        side={row.side}
                        text={row.text}
                        streaming={row.streaming}
                        tail={nextSide !== row.side}
                        footer={
                          row.key === lastRow?.key && row.side === "end" && !row.streaming
                            ? "Delivered"
                            : undefined
                        }
                      />
                    </MessageScrollerItem>
                  );
                })}

                {activeQuestion && pendingRequest ? (
                  <MessageScrollerItem messageId={`q:${pendingRequest.requestId}:${questionIndex}`}>
                    <Question
                      key={`${pendingRequest.requestId}:${activeQuestion.id}`}
                      question={activeQuestion}
                      questionIndex={questionIndex}
                      questionCount={pendingRequest.questions.length}
                      selected={selectedOptions}
                      busy={answering}
                      onPick={pickOption}
                      onSend={() => submitAnswer()}
                    />
                  </MessageScrollerItem>
                ) : pendingApproval ? (
                  <MessageScrollerItem messageId={`a:${pendingApproval.requestId}`}>
                    <Approval
                      request={pendingApproval}
                      busy={approving}
                      onRespond={respondToApproval}
                    />
                  </MessageScrollerItem>
                ) : busy ? (
                  <MessageScrollerItem messageId="typing">
                    <div className="flex flex-col gap-1.5">
                      <TypingBubble />
                      <SystemNote className="justify-start px-3">
                        {starting ? "Lighting the grill" : workingStatus}
                      </SystemNote>
                    </div>
                  </MessageScrollerItem>
                ) : null}

                {error ? (
                  <MessageScrollerItem messageId="error">
                    <SystemNote className="text-destructive">
                      <span role="alert" className="text-destructive">
                        {error}
                      </span>
                    </SystemNote>
                  </MessageScrollerItem>
                ) : null}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton className="rounded-full" />
          </MessageScroller>
        </MessageScrollerProvider>

        <Composer
          value={draft}
          onChange={setDraft}
          onSubmit={submitComposer}
          placeholder={placeholder}
          disabled={connection !== "ready" || !selectedChoice}
        />

        <DetailsSheet
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
          connectionLabel={
            connection === "ready"
              ? "Connected"
              : connection === "connecting"
                ? "Connecting…"
                : "Not reachable"
          }
          workspace={shortPath(config?.cwd ?? null)}
          choices={choices}
          selectedModelKey={selectedModelKey}
          onSelectModel={setSelectedModelKey}
          modelLocked={Boolean(threadId)}
          planMarkdown={planMarkdown}
          planFile={planFile}
          planStarted={Boolean(threadId)}
          planStatus={planStatus}
          canWrite={Boolean(thread)}
          onWritePlan={writePlan}
          onNewGrill={reset}
        />
      </div>
    </div>
  );
}
