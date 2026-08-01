import type { UserInputQuestion } from "@grillme/contracts";
import { CheckIcon } from "lucide-react";
import { memo } from "react";

import { BUBBLE_BODY, SystemNote } from "@/components/thread";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Marker, MarkerContent } from "@/components/ui/marker";
import { Message, MessageContent } from "@/components/ui/message";
import { cn } from "@/lib/utils";

export const OPTION_KEYS = "ABCDEFGH";

interface QuestionProps {
  question: UserInputQuestion;
  questionIndex: number;
  questionCount: number;
  selected: ReadonlyArray<string>;
  busy: boolean;
  onPick: (label: string) => void;
  onSend: () => void;
}

/**
 * A question renders as an ordinary received bubble followed by tappable
 * reply bubbles on the sending side — the way Messages offers suggested
 * replies. Picking one turns it into the sent message.
 */
export const Question = memo(function Question({
  question,
  questionIndex,
  questionCount,
  selected,
  busy,
  onPick,
  onSend,
}: QuestionProps) {
  return (
    <div className="flex flex-col gap-2">
      <Marker variant="separator" className="px-4">
        <MarkerContent className="text-[11px] font-medium tracking-[0.01em] text-muted-foreground">
          {question.header}
          {questionCount > 1 ? ` · ${questionIndex + 1} of ${questionCount}` : ""}
        </MarkerContent>
      </Marker>

      <Message align="start">
        <MessageContent>
          <Bubble variant="secondary" align="start" className="pop-in pop-in-start tail tail-start">
            <BubbleContent className={cn(BUBBLE_BODY, "whitespace-pre-wrap")} id="active-question">
              {question.question}
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>

      <Message align="end">
        <MessageContent
          className="gap-1.5"
          role={question.multiSelect ? "group" : "radiogroup"}
          aria-labelledby="active-question"
        >
          {question.options.map((option, index) => {
            const picked = selected.includes(option.label);
            return (
              <Bubble
                key={option.label}
                variant={picked ? "default" : "outline"}
                align="end"
                className="chip-in max-w-[86%]"
                style={{ animationDelay: `${index * 45}ms` }}
              >
                <BubbleContent
                  className={cn(
                    BUBBLE_BODY,
                    "pressable w-full cursor-pointer py-2 text-left transition-colors",
                    // The one place a component colour is overridden: suggested
                    // replies in Messages are outlined in the tint, not in grey.
                    picked ? "border-transparent!" : "border-tint/45! text-tint hover:bg-tint/8",
                  )}
                  render={
                    <button
                      type="button"
                      role={question.multiSelect ? "checkbox" : "radio"}
                      aria-checked={picked}
                      disabled={busy}
                      onClick={() => onPick(option.label)}
                    />
                  }
                >
                  <span className="flex items-start gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{option.label}</span>
                      <span
                        className={cn(
                          "mt-0.5 block text-[13px] leading-[17px]",
                          picked ? "opacity-80" : "text-muted-foreground",
                        )}
                      >
                        {option.description}
                      </span>
                    </span>
                    {question.multiSelect && picked ? (
                      <CheckIcon className="mt-1 size-4 shrink-0" />
                    ) : (
                      <kbd
                        aria-hidden="true"
                        className="mt-0.5 hidden size-[18px] shrink-0 items-center justify-center rounded-[5px] border border-current/25 font-mono text-[10px] leading-none opacity-55 pointer-fine:flex"
                      >
                        {OPTION_KEYS[index] ?? "·"}
                      </kbd>
                    )}
                  </span>
                </BubbleContent>
              </Bubble>
            );
          })}

          {question.multiSelect ? (
            <Bubble variant="default" align="end" className="chip-in">
              <BubbleContent
                className={cn(BUBBLE_BODY, "pressable cursor-pointer font-medium")}
                render={
                  <button
                    type="button"
                    disabled={busy || selected.length === 0}
                    onClick={onSend}
                    className="disabled:pointer-events-none disabled:opacity-40"
                  />
                }
              >
                {busy ? "Sending…" : `Send ${selected.length || ""}`.trim()}
              </BubbleContent>
            </Bubble>
          ) : null}
        </MessageContent>
      </Message>

      <SystemNote>
        {question.multiSelect ? "Pick any, or type your own" : "Pick one, or type your own"}
      </SystemNote>
    </div>
  );
});
