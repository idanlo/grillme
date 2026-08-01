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
  type ServerConfig,
  type ServerConfigStreamEvent,
  type UserInputQuestion,
} from "@grillme/contracts";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { buildFirstTurn, displayUserMessage } from "./protocol";
import { connectRpc, type GrillmeRpc } from "./rpc";
import {
  buildHandoffMarkdown,
  derivePendingRequest,
  deriveTranscript,
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

type StreamItem =
  | {
      kind: "said";
      key: string;
      role: "user" | "assistant";
      text: string;
      streaming: boolean;
      at: string;
    }
  | {
      kind: "locked";
      key: string;
      entry: GrillAnswer;
      index: number;
      at: string;
    };

const OPTION_KEYS = "ABCDEFGH";

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

/* ── chrome ─────────────────────────────────────────────────────────────── */

const Sigil = memo(function Sigil() {
  return (
    <svg className="sigil" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.5 C 9.6 4.2 12.5 5.4 12.5 9 a4.5 4.5 0 0 1-9 0 c0-1.7.8-2.6 1.6-3.6.2 1.2.7 1.9 1.5 2.3C6.1 5.6 6.6 3.4 8 1.5Z" />
    </svg>
  );
});

function StatusLamp({ state }: { readonly state: ConnectionState }) {
  const label =
    state === "ready" ? "connected" : state === "connecting" ? "connecting" : "no server";
  return (
    <span className={`lamp lamp-${state}`}>
      <i aria-hidden="true" />
      {label}
    </span>
  );
}

/* ── stream turns ───────────────────────────────────────────────────────── */

const Said = memo(function Said({
  role,
  text,
  streaming,
}: {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly streaming: boolean;
}) {
  return (
    <article className={`turn turn-${role}`}>
      <span className="turn-sigil" aria-hidden="true">
        {role === "user" ? "❯" : "◇"}
      </span>
      <div className="turn-body">
        <span className="turn-who">{role === "user" ? "you" : "grillme"}</span>
        <p className="turn-text">
          {text}
          {streaming ? <span className="caret caret-inline" aria-hidden="true" /> : null}
        </p>
      </div>
    </article>
  );
});

const Locked = memo(function Locked({
  entry,
  index,
}: {
  readonly entry: GrillAnswer;
  readonly index: number;
}) {
  return (
    <article className="turn turn-locked">
      <span className="turn-sigil" aria-hidden="true">
        ✓
      </span>
      <div className="turn-body">
        <span className="turn-who">
          decision {String(index).padStart(2, "0")} · {entry.question.header.toLowerCase()}
        </span>
        <p className="locked-question">{entry.question.question}</p>
        <p className="locked-answer">{answerText(entry.answer)}</p>
      </div>
    </article>
  );
});

function Thinking({ note }: { readonly note: string }) {
  return (
    <article className="turn turn-thinking" aria-live="polite">
      <span className="turn-sigil" aria-hidden="true">
        ◇
      </span>
      <div className="turn-body">
        <span className="turn-who">grillme</span>
        <p className="thinking-line">
          <span className="scan" aria-hidden="true" />
          {note}
        </p>
      </div>
    </article>
  );
}

interface DecisionProps {
  question: UserInputQuestion;
  questionIndex: number;
  questionCount: number;
  decisionNumber: number;
  selected: ReadonlyArray<string>;
  busy: boolean;
  onToggle: (label: string) => void;
  onSubmit: () => void;
}

const Decision = memo(function Decision({
  question,
  questionIndex,
  questionCount,
  decisionNumber,
  selected,
  busy,
  onToggle,
  onSubmit,
}: DecisionProps) {
  const hasAnswer = selected.length > 0;
  return (
    <section className="decision" aria-labelledby="active-question">
      <header className="decision-head">
        <span className="decision-tag">
          decision {String(decisionNumber).padStart(2, "0")} · {question.header.toLowerCase()}
        </span>
        {questionCount > 1 ? (
          <span className="decision-count">
            {questionIndex + 1}/{questionCount}
          </span>
        ) : null}
      </header>

      <h2 id="active-question">{question.question}</h2>

      <div className="options" role={question.multiSelect ? "group" : "radiogroup"}>
        {question.options.map((option, index) => {
          const active = selected.includes(option.label);
          return (
            <button
              key={option.label}
              type="button"
              role={question.multiSelect ? "checkbox" : "radio"}
              aria-checked={active}
              className={`option${active ? " is-picked" : ""}`}
              style={{ animationDelay: `${index * 45}ms` }}
              onClick={() => onToggle(option.label)}
            >
              <kbd>{OPTION_KEYS[index] ?? "·"}</kbd>
              <span className="option-body">
                <span className="option-label">
                  {option.label}
                  {index === 0 ? <em>recommended</em> : null}
                </span>
                <span className="option-desc">{option.description}</span>
              </span>
            </button>
          );
        })}
      </div>

      <footer className="decision-foot">
        <span>
          {question.multiSelect ? "pick any" : "pick one"} — press a key, or type your own answer
          below
        </span>
        <button type="button" className="lock" disabled={!hasAnswer || busy} onClick={onSubmit}>
          {busy ? "sending…" : questionIndex + 1 < questionCount ? "next ⏎" : "lock it in ⏎"}
        </button>
      </footer>
    </section>
  );
});

/* ── plan pane ──────────────────────────────────────────────────────────── */

function PlanLine({ line }: { readonly line: string }) {
  if (line.startsWith("### ")) return <span className="pl pl-h3">{line}</span>;
  if (line.startsWith("## ")) return <span className="pl pl-h2">{line}</span>;
  if (line.startsWith("# ")) return <span className="pl pl-h1">{line}</span>;
  if (line.startsWith("- ")) return <span className="pl pl-li">{line}</span>;
  if (line.startsWith("_")) return <span className="pl pl-dim">{line}</span>;
  return <span className="pl">{line || " "}</span>;
}

function PlanPane({
  markdown,
  filename,
  live,
  status,
  canWrite,
  onWrite,
}: {
  readonly markdown: string;
  readonly filename: string;
  readonly live: boolean;
  readonly status: string | null;
  readonly canWrite: boolean;
  readonly onWrite: () => void;
}) {
  const lines = useMemo(() => markdown.split("\n"), [markdown]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const count = lines.length;

  useEffect(() => {
    const node = bodyRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [count]);

  return (
    <aside className="plan">
      <header className="plan-head">
        <span className="plan-file">{live ? filename : "plan.md"}</span>
        <span className="plan-meta">{live ? `${count} lines` : "not started"}</span>
      </header>
      <div className="plan-body" ref={bodyRef}>
        {live ? (
          <pre className="plan-buffer">
            {lines.map((line, index) => (
              // eslint-disable-next-line react/no-array-index-key
              <PlanLine key={index} line={line} />
            ))}
            <span className="caret" aria-hidden="true" />
          </pre>
        ) : (
          <p className="plan-empty">
            The plan writes itself here. Every answer you lock in becomes a line another agent can
            execute.
          </p>
        )}
      </div>
      <button type="button" className="plan-write" disabled={!canWrite} onClick={onWrite}>
        {status ?? `write ${filename}`}
      </button>
    </aside>
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
  const [questionIndex, setQuestionIndex] = useState(0);
  const [draftAnswers, setDraftAnswers] = useState<Record<string, string | ReadonlyArray<string>>>(
    {},
  );
  const [selectedOptions, setSelectedOptions] = useState<ReadonlyArray<string>>([]);
  const [planStatus, setPlanStatus] = useState<string | null>(null);
  const [planFile] = useState(() => handoffFilename());

  const streamRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

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
  const activeQuestion = pendingRequest?.questions[questionIndex] ?? null;
  const running = Boolean(threadId) && (!thread || thread.session?.status === "running");

  const stream = useMemo<ReadonlyArray<StreamItem>>(() => {
    const items: StreamItem[] = [];
    for (const message of thread?.messages ?? []) {
      const text = message.role === "user" ? displayUserMessage(message.text) : message.text;
      if (!text.trim()) continue;
      if (message.role !== "user" && message.role !== "assistant") continue;
      items.push({
        kind: "said",
        key: message.id,
        role: message.role,
        text: text.trim(),
        streaming: message.streaming,
        at: message.createdAt,
      });
    }
    let locked = 0;
    for (const entry of transcript) {
      if (entry.answer === null) continue;
      locked += 1;
      items.push({
        kind: "locked",
        key: `${entry.requestId}:${entry.question.id}`,
        entry,
        index: locked,
        at: entry.askedAt,
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

  useEffect(() => {
    const node = streamRef.current;
    if (!node) return;
    node.scrollTo({
      top: node.scrollHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [stream.length, pendingRequest?.requestId, questionIndex, running]);

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
    setPlanStatus("writing…");
    void rpc
      .writeFile({
        cwd: config.cwd,
        relativePath: planFile,
        contents: planMarkdown,
      })
      .then((result) => setPlanStatus(`saved ${result.relativePath}`))
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
    composerRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    const node = composerRef.current;
    if (!node) return;
    node.style.height = "0px";
    node.style.height = `${Math.min(node.scrollHeight, 200)}px`;
  }, [draft]);

  const placeholder = !threadId
    ? "Describe what you want to build, change, or decide…"
    : activeQuestion
      ? "…or answer in your own words"
      : "Add context, correct an assumption, push back…";

  const busy = starting || running;

  return (
    <div className="shell">
      <header className="bar">
        <div className="bar-brand">
          <Sigil />
          <span className="wordmark">grillme</span>
        </div>
        <div className="bar-meta">
          <span className="crumb" title={config?.cwd ?? "Waiting for the local server"}>
            {shortPath(config?.cwd ?? null)}
          </span>
          <span className="crumb-sep" aria-hidden="true">
            ·
          </span>
          <span className="crumb">read-only</span>
        </div>
        <div className="bar-right">
          {threadId ? (
            <button type="button" className="ghost" onClick={reset}>
              new grill
            </button>
          ) : null}
          <StatusLamp state={connection} />
        </div>
      </header>

      <div className="stage">
        <div className="console">
          <main className="stream" ref={streamRef}>
            <div className="stream-inner">
              <section className="boot" aria-label="Session start">
                <p className="boot-line">
                  <b>grillme</b> — one hard question at a time, until the plan has no blanks.
                </p>
                <p className="boot-line boot-dim">
                  It reads your repo to check facts. It never edits your code. You make every call.
                </p>
                {!threadId ? (
                  <p className="boot-line boot-cue">What are we pressure-testing?</p>
                ) : null}
              </section>

              {stream.map((item) =>
                item.kind === "said" ? (
                  <Said
                    key={item.key}
                    role={item.role}
                    text={item.text}
                    streaming={item.streaming}
                  />
                ) : (
                  <Locked key={item.key} entry={item.entry} index={item.index} />
                ),
              )}

              {activeQuestion && pendingRequest ? (
                <Decision
                  key={`${pendingRequest.requestId}:${activeQuestion.id}`}
                  question={activeQuestion}
                  questionIndex={questionIndex}
                  questionCount={pendingRequest.questions.length}
                  decisionNumber={
                    transcript.filter((entry) => entry.answer !== null).length + questionIndex + 1
                  }
                  selected={selectedOptions}
                  busy={answering}
                  onToggle={pickOption}
                  onSubmit={() => submitAnswer()}
                />
              ) : busy ? (
                <Thinking
                  note={starting ? "lighting the grill" : "reading the repository for facts"}
                />
              ) : null}

              {error ? (
                <p className="stream-error" role="alert">
                  <span aria-hidden="true">!</span> {error}
                </p>
              ) : null}
            </div>
          </main>

          <footer className="composer">
            <form
              className="composer-input"
              onSubmit={(event) => {
                event.preventDefault();
                submitComposer();
              }}
            >
              <span className="composer-sigil" aria-hidden="true">
                ❯
              </span>
              <textarea
                ref={composerRef}
                autoFocus
                rows={1}
                value={draft}
                spellCheck={false}
                placeholder={placeholder}
                aria-label={placeholder}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submitComposer();
                  }
                }}
              />
              <button
                type="submit"
                className="send"
                disabled={!draft.trim() || connection !== "ready" || !selectedChoice}
              >
                ⏎
              </button>
            </form>
            <div className="composer-foot">
              <label className="picker">
                <span>interviewer</span>
                <select
                  value={selectedModelKey}
                  disabled={Boolean(threadId)}
                  onChange={(event) => setSelectedModelKey(event.target.value)}
                >
                  {choices.length === 0 ? <option value="">no models configured</option> : null}
                  {choices.map((choice) => (
                    <option key={choice.key} value={choice.key}>
                      {choice.providerName} · {choice.modelName}
                    </option>
                  ))}
                </select>
              </label>
              <span className="hint">
                <kbd>⏎</kbd> send <kbd>⇧⏎</kbd> newline
                {activeQuestion ? (
                  <>
                    {" "}
                    <kbd>A–{OPTION_KEYS[activeQuestion.options.length - 1]}</kbd> pick
                  </>
                ) : null}
              </span>
            </div>
          </footer>
        </div>

        <PlanPane
          markdown={planMarkdown}
          filename={planFile}
          live={Boolean(threadId)}
          status={planStatus}
          canWrite={Boolean(thread)}
          onWrite={writePlan}
        />
      </div>
    </div>
  );
}
