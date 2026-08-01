import { CheckIcon } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sigil } from "@/components/sigil";
import { cn } from "@/lib/utils";

export interface ModelChoice {
  key: string;
  providerName: string;
  modelName: string;
}

/** iOS grouped-list row: label on the left, value or control on the right. */
function Row({
  label,
  children,
  className,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-11 items-center justify-between gap-3 px-4 py-2 text-[15px] tracking-[-0.01em]",
        "border-b border-border last:border-b-0",
        className,
      )}
    >
      <span className="shrink-0">{label}</span>
      {children}
    </div>
  );
}

function Group({ children }: { readonly children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-[10px] bg-popover">{children}</div>;
}

function PlanLine({ line }: { readonly line: string }) {
  if (line.startsWith("### ")) return <span className="block font-semibold">{line.slice(4)}</span>;
  if (line.startsWith("## ")) return <span className="mt-2 block text-tint">{line.slice(3)}</span>;
  if (line.startsWith("# "))
    return <span className="block text-[13px] font-semibold">{line.slice(2)}</span>;
  if (line.startsWith("- ")) return <span className="block pl-3 -indent-3">{line}</span>;
  return <span className="block">{line || " "}</span>;
}

export function DetailsSheet({
  open,
  onOpenChange,
  connectionLabel,
  workspace,
  choices,
  selectedModelKey,
  selectedModelName,
  onSelectModel,
  modelLocked,
  planMarkdown,
  planFile,
  planStarted,
  planStatus,
  canWrite,
  onWritePlan,
  onNewGrill,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly connectionLabel: string;
  readonly workspace: string;
  readonly choices: ReadonlyArray<ModelChoice>;
  readonly selectedModelKey: string;
  readonly selectedModelName: string | null;
  readonly onSelectModel: (key: string) => void;
  readonly modelLocked: boolean;
  readonly planMarkdown: string;
  readonly planFile: string;
  readonly planStarted: boolean;
  readonly planStatus: string | null;
  readonly canWrite: boolean;
  readonly onWritePlan: () => void;
  readonly onNewGrill: () => void;
}) {
  const lines = useMemo(() => planMarkdown.split("\n"), [planMarkdown]);
  const planRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const node = planRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [open, lines.length]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="mx-auto h-[86%] max-w-[430px] gap-0 rounded-t-[14px] bg-[var(--stage)] p-0"
      >
        {/* Grabber, then a title bar that mirrors the thread's own chrome. */}
        <div className="flex shrink-0 flex-col items-center pt-2 pb-1">
          <span aria-hidden="true" className="h-[5px] w-9 rounded-full bg-muted-foreground/40" />
        </div>
        <div className="flex shrink-0 items-center justify-between px-4 pb-3">
          <SheetTitle className="text-[17px] font-semibold tracking-[-0.02em]">Details</SheetTitle>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="pressable text-[17px] text-tint"
          >
            Done
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pb-8">
          <div className="flex flex-col items-center gap-2 pt-1">
            <Sigil className="size-16" />
            <div className="text-center">
              <p className="text-[17px] font-semibold tracking-[-0.02em]">grillme</p>
              <SheetDescription className="text-[13px]">
                One hard question at a time, until the plan has no blanks.
              </SheetDescription>
            </div>
          </div>

          <section className="flex flex-col gap-2">
            <h3 className="px-4 text-[13px] font-normal text-muted-foreground uppercase">
              Session
            </h3>
            <Group>
              <Row label="Server">
                <span className="text-muted-foreground">{connectionLabel}</span>
              </Row>
              <Row label="Workspace">
                <span className="truncate font-mono text-[13px] text-muted-foreground">
                  {workspace}
                </span>
              </Row>
              <Row label="Access">
                <span className="text-muted-foreground">Read-only</span>
              </Row>
              <Row label="Interviewer">
                <Select
                  value={selectedModelKey}
                  onValueChange={(value) => onSelectModel(String(value))}
                  disabled={modelLocked || choices.length === 0}
                >
                  <SelectTrigger
                    size="sm"
                    className="max-w-[58%] border-none bg-transparent px-0 text-[15px] text-muted-foreground dark:bg-transparent dark:hover:bg-transparent"
                  >
                    <SelectValue placeholder="No models configured">
                      {selectedModelName ?? undefined}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {choices.map((choice) => (
                      <SelectItem key={choice.key} value={choice.key}>
                        {choice.providerName} · {choice.modelName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
            </Group>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="flex items-center justify-between px-4 text-[13px] font-normal text-muted-foreground uppercase">
              <span>Plan</span>
              <span className="font-mono normal-case">{planStarted ? planFile : "—"}</span>
            </h3>
            <Group>
              <div
                ref={planRef}
                className="max-h-[38vh] overflow-y-auto px-4 py-3 font-mono text-[11px] leading-[17px] text-muted-foreground"
              >
                {planStarted ? (
                  lines.map((line, index) => (
                    // eslint-disable-next-line react/no-array-index-key
                    <PlanLine key={index} line={line} />
                  ))
                ) : (
                  <p className="py-4 text-center font-sans text-[13px]">
                    The plan writes itself here. Every answer you lock in becomes a line another
                    agent can execute.
                  </p>
                )}
              </div>
              <button
                type="button"
                disabled={!canWrite}
                onClick={onWritePlan}
                className="pressable flex h-11 w-full items-center justify-center gap-1.5 border-t border-border text-[15px] font-medium text-tint transition-colors hover:bg-muted active:bg-muted disabled:opacity-40"
              >
                {planStatus ? <CheckIcon className="size-4" /> : null}
                {planStatus ?? "Save to repository"}
              </button>
            </Group>
          </section>

          <Group>
            <button
              type="button"
              onClick={() => {
                onNewGrill();
                onOpenChange(false);
              }}
              className="pressable flex h-11 w-full items-center justify-center text-[15px] text-destructive transition-colors hover:bg-muted active:bg-muted"
            >
              Start a new grill
            </button>
          </Group>
        </div>
      </SheetContent>
    </Sheet>
  );
}
