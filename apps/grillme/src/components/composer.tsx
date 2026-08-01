import { ArrowUpIcon } from "lucide-react";
import { useLayoutEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/**
 * The Messages composer: a hairline pill that grows with the text, and a
 * send button that scales in only once there is something to send.
 */
export function Composer({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly placeholder: string;
  readonly disabled: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const canSend = value.trim().length > 0 && !disabled;

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.style.height = "0px";
    node.style.height = `${Math.min(node.scrollHeight, 132)}px`;
  }, [value]);

  return (
    <form
      className="chrome-bar hairline-t z-10 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="flex items-end gap-2 rounded-[19px] border border-input py-[5px] pr-[5px] pl-3.5">
        <textarea
          ref={ref}
          autoFocus
          rows={1}
          value={value}
          spellCheck={false}
          placeholder={placeholder}
          aria-label={placeholder}
          className={cn(
            "max-h-[132px] min-h-[26px] w-full flex-1 resize-none bg-transparent py-[2px]",
            "text-[17px] leading-[22px] tracking-[-0.012em] outline-none",
            "placeholder:text-muted-foreground",
          )}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
        <button
          type="submit"
          disabled={!canSend}
          aria-label="Send"
          className={cn(
            "pressable flex size-[28px] shrink-0 items-center justify-center rounded-full",
            "bg-tint text-white transition-[opacity,scale] duration-200 ease-[var(--ease-out-strong)]",
            canSend ? "scale-100 opacity-100" : "pointer-events-none scale-90 opacity-0",
          )}
        >
          <ArrowUpIcon className="size-[18px]" strokeWidth={2.75} />
        </button>
      </div>
    </form>
  );
}
