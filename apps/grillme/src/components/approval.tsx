import type { ProviderApprovalDecision } from "@grillme/contracts";
import { memo } from "react";

import type { PendingApprovalRequest } from "@/transcript";
import { SystemNote } from "@/components/thread";
import { cn } from "@/lib/utils";

/**
 * Permission prompts land as an iOS alert dropped into the thread: title,
 * detail, and two buttons split by a hairline. Destructive-by-default —
 * the safe answer is the one that keeps this interview read-only.
 */
export const Approval = memo(function Approval({
  request,
  busy,
  onRespond,
}: {
  readonly request: PendingApprovalRequest;
  readonly busy: boolean;
  readonly onRespond: (decision: ProviderApprovalDecision) => void;
}) {
  const canAllow = request.requestKind !== "file-change";

  return (
    <div className="flex flex-col gap-2">
      <SystemNote>Permission</SystemNote>
      <div className="chip-in mx-auto w-[86%] overflow-hidden rounded-[14px] bg-popover shadow-[0_1px_2px_oklch(0_0_0/10%),0_12px_28px_-12px_oklch(0_0_0/35%)]">
        <div className="flex flex-col gap-1.5 px-4 pt-4 pb-3.5 text-center">
          <h2 className="text-[15px] leading-5 font-semibold tracking-[-0.01em]">
            {canAllow ? "“grillme” wants to read this repository" : "grillme tried to edit a file"}
          </h2>
          <p className="text-[13px] leading-[17px] text-muted-foreground">
            {canAllow
              ? "Review the command before allowing it. Access is granted once."
              : "Writes are blocked so the interview stays read-only."}
          </p>
          <pre className="mt-1.5 max-h-40 overflow-auto rounded-lg bg-muted px-2.5 py-2 text-left font-mono text-[11px] leading-[15px] wrap-break-word whitespace-pre-wrap">
            {request.detail}
          </pre>
        </div>
        <div className="grid grid-cols-2 divide-x divide-border border-t border-border">
          <button
            type="button"
            disabled={busy}
            onClick={() => onRespond("decline")}
            className={cn(
              "h-11 text-[17px] tracking-[-0.01em] text-tint transition-colors",
              "hover:bg-muted active:bg-muted disabled:opacity-40",
              canAllow ? "" : "col-span-2 border-none font-semibold",
            )}
          >
            {canAllow ? "Don’t Allow" : "OK"}
          </button>
          {canAllow ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onRespond("accept")}
              className="h-11 text-[17px] font-semibold tracking-[-0.01em] text-tint transition-colors hover:bg-muted active:bg-muted disabled:opacity-40"
            >
              {busy ? "Allowing…" : "Allow"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
});
