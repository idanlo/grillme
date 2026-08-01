import { memo } from "react";

import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Marker, MarkerContent } from "@/components/ui/marker";
import { Message, MessageContent, MessageFooter } from "@/components/ui/message";
import { cn } from "@/lib/utils";

/** iMessage sets body copy at 17px/22px inside an 18px corner. */
export const BUBBLE_BODY =
  "relative z-[1] overflow-visible rounded-[18px] px-[13px] py-[7px] text-[17px] leading-[22px] tracking-[-0.012em]";

export function tailClass(side: "start" | "end", tail: boolean): string {
  return tail ? (side === "start" ? "tail tail-start" : "tail tail-end") : "";
}

/**
 * One bubble in the thread. `tail` marks the last bubble of a run from the
 * same sender — only that one gets the curl, exactly like Messages.
 */
export const ChatBubble = memo(function ChatBubble({
  side,
  text,
  tail = true,
  footer,
  streaming = false,
}: {
  readonly side: "start" | "end";
  readonly text: string;
  readonly tail?: boolean;
  readonly footer?: string | undefined;
  readonly streaming?: boolean;
}) {
  return (
    <Message align={side}>
      <MessageContent>
        <Bubble
          variant={side === "end" ? "default" : "secondary"}
          align={side}
          className={cn(
            "pop-in",
            side === "end" ? "pop-in-end" : "pop-in-start",
            tailClass(side, tail),
          )}
        >
          <BubbleContent className={cn(BUBBLE_BODY, "whitespace-pre-wrap")}>
            {text}
            {streaming ? (
              <span
                aria-hidden="true"
                className="ml-0.5 inline-block h-[15px] w-[2px] translate-y-[2px] animate-pulse rounded-full bg-current align-baseline"
              />
            ) : null}
          </BubbleContent>
        </Bubble>
        {footer ? <MessageFooter className="text-[11px]">{footer}</MessageFooter> : null}
      </MessageContent>
    </Message>
  );
});

/** The three-dot bubble Messages shows while the other side is typing. */
export function TypingBubble() {
  return (
    <Message align="start" aria-label="grillme is typing">
      <MessageContent>
        <Bubble variant="secondary" align="start" className="pop-in pop-in-start tail tail-start">
          <BubbleContent className={cn(BUBBLE_BODY, "px-3.5 py-3")}>
            <span className="flex items-center gap-1.5" aria-hidden="true">
              {[0, 1, 2].map((index) => (
                <span
                  key={index}
                  className="typing-dot size-2 rounded-full bg-muted-foreground"
                  style={{ animationDelay: `${index * 180}ms` }}
                />
              ))}
            </span>
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

/** Centred system text: date dividers, status lines, the empty-thread note. */
export function SystemNote({
  children,
  className,
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <Marker className={cn("justify-center px-6", className)}>
      <MarkerContent className="text-center text-[11px] leading-4 tracking-[0.01em] text-muted-foreground">
        {children}
      </MarkerContent>
    </Marker>
  );
}

export function DayDivider({ label, time }: { readonly label: string; readonly time: string }) {
  return (
    <SystemNote>
      <span className="font-semibold">{label}</span> {time}
    </SystemNote>
  );
}
