import { applyThreadDetailEvent } from "@grillme/client-runtime/state/threads";
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
  type UserInputQuestion,
} from "@grillme/contracts";
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronRightIcon,
  DownloadIcon,
  FlameIcon,
  FolderIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
  SearchIcon,
  SparklesIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import { buildFirstTurn, displayUserMessage } from "./protocol";
import { connectRpc, type GrillmeRpc } from "./rpc";
import {
  buildHandoffMarkdown,
  derivePendingRequest,
  deriveTranscript,
  handoffFilename,
} from "./transcript";

type ConnectionState = "connecting" | "ready" | "error";

interface ModelChoice {
  key: string;
  providerName: string;
  modelName: string;
  selection: ModelSelection;
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
  return "The local Grillme server could not be reached.";
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

const Brand = memo(function Brand() {
  return (
    <div className="brand" aria-label="Grillme">
      <span className="brand-mark">
        <FlameIcon aria-hidden="true" />
      </span>
      <span className="brand-word">grillme</span>
      <span className="brand-tag">decision pressure-test</span>
    </div>
  );
});

function ConnectionPill({ state }: { readonly state: ConnectionState }) {
  return (
    <div className={`connection-pill connection-${state}`}>
      <span className="connection-dot" />
      {state === "ready" ? "Local agent ready" : state === "connecting" ? "Heating up" : "Offline"}
    </div>
  );
}

function WorkspacePath({ path }: { readonly path: string | null }) {
  if (!path) return null;

  return (
    <div className="workspace-path" title={path} aria-label={`Current workspace: ${path}`}>
      <FolderIcon aria-hidden="true" />
      <span className="workspace-path-label">cwd</span>
      <span className="workspace-path-value">{path}</span>
    </div>
  );
}

function HeatRail({ answered }: { readonly answered: number }) {
  const heat = Math.min(answered, 5);
  return (
    <div className="heat-rail" aria-label={`${answered} decisions resolved`}>
      <div className="heat-label">
        <span>Session heat</span>
        <strong>{answered}</strong>
      </div>
      <div className="heat-bars" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((index) => (
          <span key={index} className={index < heat ? "is-hot" : ""} />
        ))}
      </div>
    </div>
  );
}

interface QuestionCardProps {
  question: UserInputQuestion;
  questionIndex: number;
  questionCount: number;
  selected: ReadonlyArray<string>;
  customAnswer: string;
  busy: boolean;
  onToggle: (label: string) => void;
  onCustomAnswer: (value: string) => void;
  onSubmit: () => void;
}

const QuestionCard = memo(function QuestionCard({
  question,
  questionIndex,
  questionCount,
  selected,
  customAnswer,
  busy,
  onToggle,
  onCustomAnswer,
  onSubmit,
}: QuestionCardProps) {
  const hasAnswer = selected.length > 0 || customAnswer.trim().length > 0;
  return (
    <section className="question-card" aria-labelledby="active-question">
      <div className="question-eyebrow">
        <span>{question.header}</span>
        {questionCount > 1 ? (
          <span>
            {questionIndex + 1} / {questionCount}
          </span>
        ) : null}
      </div>
      <h2 id="active-question">{question.question}</h2>
      <p className="decision-note">
        Your agent recommends the first path. The decision is still yours.
      </p>

      <div className="option-stack" role={question.multiSelect ? "group" : "radiogroup"}>
        {question.options.map((option, index) => {
          const active = selected.includes(option.label);
          return (
            <button
              key={option.label}
              type="button"
              role={question.multiSelect ? "checkbox" : "radio"}
              aria-checked={active}
              className={`option-card ${active ? "is-selected" : ""}`}
              onClick={() => onToggle(option.label)}
            >
              <span className="option-index">{String.fromCharCode(65 + index)}</span>
              <span className="option-copy">
                <span className="option-title">
                  {option.label}
                  {index === 0 ? <em>Recommended</em> : null}
                </span>
                <span className="option-description">{option.description}</span>
              </span>
              <span className="option-check">{active ? <CheckIcon /> : <ChevronRightIcon />}</span>
            </button>
          );
        })}
      </div>

      <label className="custom-answer">
        <span>Or answer in your own words</span>
        <textarea
          value={customAnswer}
          onChange={(event) => onCustomAnswer(event.target.value)}
          placeholder="Add a constraint, nuance, or a completely different direction…"
          rows={3}
        />
      </label>

      <button
        className="primary-action"
        type="button"
        disabled={!hasAnswer || busy}
        onClick={onSubmit}
      >
        {busy ? <LoaderCircleIcon className="spin" /> : null}
        {questionIndex + 1 < questionCount ? "Next question" : "Lock this answer"}
        {!busy ? <ArrowRightIcon /> : null}
      </button>
    </section>
  );
});

function SetupScreen({
  prompt,
  selectedModelKey,
  choices,
  connection,
  error,
  onPromptChange,
  onModelChange,
  onStart,
}: {
  readonly prompt: string;
  readonly selectedModelKey: string;
  readonly choices: ReadonlyArray<ModelChoice>;
  readonly connection: ConnectionState;
  readonly error: string | null;
  readonly onPromptChange: (value: string) => void;
  readonly onModelChange: (value: string) => void;
  readonly onStart: () => void;
}) {
  const disabled = connection !== "ready" || prompt.trim().length === 0 || !selectedModelKey;
  return (
    <main className="setup-shell">
      <section className="setup-copy">
        <div className="kicker">
          <span /> Sharpen the brief before anyone builds
        </div>
        <h1>
          Put your idea
          <br />
          on the <em>hot seat.</em>
        </h1>
        <p>
          Grillme investigates your codebase, finds the unknowns, and asks one hard decision at a
          time. You leave with a handoff another agent can actually execute.
        </p>
        <div className="principles">
          <span>
            <SearchIcon /> Facts are investigated
          </span>
          <span>
            <SparklesIcon /> Decisions stay yours
          </span>
        </div>
      </section>

      <section className="prompt-card">
        <div className="prompt-card-top">
          <span>01</span>
          <strong>What are we pressure-testing?</strong>
        </div>
        <textarea
          autoFocus
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder="Describe what you want to build, change, or decide…"
          rows={8}
        />
        <div className="prompt-controls">
          <label>
            <span>Interviewer</span>
            <select
              value={selectedModelKey}
              onChange={(event) => onModelChange(event.target.value)}
            >
              {choices.length === 0 ? <option value="">No configured models</option> : null}
              {choices.map((choice) => (
                <option key={choice.key} value={choice.key}>
                  {choice.providerName} · {choice.modelName}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="start-button" onClick={onStart} disabled={disabled}>
            Start grilling <FlameIcon />
          </button>
        </div>
        {error ? <p className="error-callout">{error}</p> : null}
        <p className="safety-note">
          Read-only interview. Grillme will investigate, but it will not edit your code.
        </p>
      </section>
    </main>
  );
}

export function App() {
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [rpc, setRpc] = useState<GrillmeRpc | null>(null);
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [projects, setProjects] = useState<ReadonlyArray<OrchestrationProjectShell>>([]);
  const [prompt, setPrompt] = useState("");
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
  const [customAnswer, setCustomAnswer] = useState("");
  const [handoffStatus, setHandoffStatus] = useState<string | null>(null);
  const [followup, setFollowup] = useState("");

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

  useEffect(() => {
    let active = true;
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
    setCustomAnswer("");
  }, [pendingRequest?.requestId]);

  const startGrill = useCallback(() => {
    if (!rpc || !config || !selectedChoice || !prompt.trim() || starting) return;
    setStarting(true);
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
          text: buildFirstTurn(prompt),
          attachments: [],
        },
        modelSelection: selectedChoice.selection,
        titleSeed: prompt.slice(0, 80),
        runtimeMode: "approval-required",
        interactionMode: "plan",
        bootstrap: {
          createThread: {
            projectId: project.id,
            title: prompt.slice(0, 80),
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
  }, [config, projects, prompt, rpc, selectedChoice, starting]);

  const toggleOption = useCallback(
    (label: string) => {
      if (!activeQuestion) return;
      setCustomAnswer("");
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

  const submitAnswer = useCallback(() => {
    if (!rpc || !threadId || !pendingRequest || !activeQuestion || answering) return;
    const answer =
      customAnswer.trim() || (activeQuestion.multiSelect ? selectedOptions : selectedOptions[0]);
    if (!answer || (Array.isArray(answer) && answer.length === 0)) return;
    const nextAnswers = { ...draftAnswers, [activeQuestion.id]: answer };
    if (questionIndex + 1 < pendingRequest.questions.length) {
      setDraftAnswers(nextAnswers);
      setQuestionIndex((current) => current + 1);
      setSelectedOptions([]);
      setCustomAnswer("");
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
  }, [
    activeQuestion,
    answering,
    customAnswer,
    draftAnswers,
    pendingRequest,
    questionIndex,
    rpc,
    selectedOptions,
    threadId,
  ]);

  const saveHandoff = useCallback(() => {
    if (!rpc || !config || !thread) return;
    const filename = handoffFilename();
    setHandoffStatus("Saving…");
    void rpc
      .writeFile({
        cwd: config.cwd,
        relativePath: filename,
        contents: buildHandoffMarkdown({ prompt, transcript }),
      })
      .then((result) => setHandoffStatus(`Saved ${result.relativePath}`))
      .catch((cause) => {
        setHandoffStatus(null);
        setError(formatError(cause));
      });
  }, [config, prompt, rpc, thread, transcript]);

  const sendFollowup = useCallback(() => {
    if (!rpc || !threadId || !followup.trim() || !selectedChoice) return;
    const message = followup.trim();
    setFollowup("");
    void rpc
      .dispatch({
        type: "thread.turn.start",
        commandId: id(CommandId),
        threadId,
        message: { messageId: id(MessageId), role: "user", text: message, attachments: [] },
        modelSelection: selectedChoice.selection,
        runtimeMode: "approval-required",
        interactionMode: "plan",
        createdAt: now(),
      })
      .catch((cause) => setError(formatError(cause)));
  }, [followup, rpc, selectedChoice, threadId]);

  const reset = useCallback(() => {
    setThreadId(null);
    setThread(null);
    setPrompt("");
    setError(null);
    setHandoffStatus(null);
  }, []);

  return (
    <div className="app-frame">
      <header className="topbar">
        <Brand />
        <div className="topbar-actions">
          <WorkspacePath path={config?.cwd ?? null} />
          {thread ? (
            <button type="button" className="ghost-button" onClick={reset}>
              <RotateCcwIcon /> New grill
            </button>
          ) : null}
          <ConnectionPill state={connection} />
        </div>
      </header>

      {!threadId ? (
        <SetupScreen
          prompt={prompt}
          selectedModelKey={selectedModelKey}
          choices={choices}
          connection={connection}
          error={error}
          onPromptChange={setPrompt}
          onModelChange={setSelectedModelKey}
          onStart={startGrill}
        />
      ) : (
        <main className="session-shell">
          <aside className="session-sidebar">
            <HeatRail answered={transcript.filter((entry) => entry.answer !== null).length} />
            <div className="brief-block">
              <span>Original brief</span>
              <p>{prompt}</p>
            </div>
            <div className="decision-log">
              <div className="sidebar-heading">
                <span>Decision log</span>
                <strong>{transcript.length}</strong>
              </div>
              {transcript.length === 0 ? (
                <p className="empty-log">Questions will collect here as the agent investigates.</p>
              ) : (
                transcript.map((entry, index) => (
                  <div className="decision-row" key={`${entry.requestId}-${entry.question.id}`}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>{entry.question.header}</strong>
                      <p>{entry.answer ?? "Waiting for answer"}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
            <button
              type="button"
              className="handoff-button"
              disabled={!thread}
              onClick={saveHandoff}
            >
              <DownloadIcon /> {handoffStatus ?? "Create Markdown handoff"}
            </button>
          </aside>

          <section className="interview-stage">
            <div className="stage-status">
              <span className={thread?.session?.status === "running" ? "pulse" : ""} />
              {pendingRequest
                ? "Decision needed"
                : thread?.session?.status === "running" || !thread
                  ? "Agent is investigating your workspace"
                  : "Ready for more context"}
            </div>

            {error ? <div className="session-error">{error}</div> : null}

            {activeQuestion && pendingRequest ? (
              <QuestionCard
                question={activeQuestion}
                questionIndex={questionIndex}
                questionCount={pendingRequest.questions.length}
                selected={selectedOptions}
                customAnswer={customAnswer}
                busy={answering}
                onToggle={toggleOption}
                onCustomAnswer={(value) => {
                  setCustomAnswer(value);
                  setSelectedOptions([]);
                }}
                onSubmit={submitAnswer}
              />
            ) : (
              <section className="waiting-card">
                <div className="ember-orbit">
                  <FlameIcon />
                </div>
                <h2>
                  {thread?.session?.status === "running" || !thread
                    ? "Finding the next weak spot…"
                    : "Anything else to pressure-test?"}
                </h2>
                <p>
                  {thread?.session?.status === "running" || !thread
                    ? "The agent is reading the repository and resolving facts before it asks you to make a decision."
                    : "Add context, correct an assumption, or confirm that the shared understanding is complete."}
                </p>
                {thread && thread.session?.status !== "running" ? (
                  <div className="followup-box">
                    <textarea
                      value={followup}
                      onChange={(event) => setFollowup(event.target.value)}
                      placeholder="Add context or confirm shared understanding…"
                      rows={3}
                    />
                    <button type="button" onClick={sendFollowup} disabled={!followup.trim()}>
                      <ArrowRightIcon />
                    </button>
                  </div>
                ) : null}
              </section>
            )}

            {thread?.messages.length ? (
              <details className="conversation-drawer">
                <summary>
                  Conversation trace <span>{thread.messages.length}</span>
                </summary>
                <div className="message-list">
                  {thread.messages.map((message) => (
                    <article key={message.id} className={`message message-${message.role}`}>
                      <span>{message.role === "assistant" ? "Agent" : "You"}</span>
                      <p>
                        {message.role === "user" ? displayUserMessage(message.text) : message.text}
                      </p>
                    </article>
                  ))}
                </div>
              </details>
            ) : null}
          </section>
        </main>
      )}

      {starting ? (
        <div className="launch-overlay">
          <LoaderCircleIcon className="spin" />
          <span>Lighting the grill</span>
        </div>
      ) : null}
    </div>
  );
}
