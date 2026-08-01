import { memo } from "react";

import { cn } from "@/lib/utils";

/**
 * The contact avatar. Everything else on screen is iOS system colour, so the
 * ember is the one warm thing in the app — that is the whole identity.
 */
export const Sigil = memo(function Sigil({ className }: { readonly className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full",
        "bg-[linear-gradient(160deg,#FF9A3D,#F2542D_62%,#D6321F)]",
        className,
      )}
    >
      <svg viewBox="0 0 16 16" className="h-[62%] w-[62%] fill-white">
        <path d="M8 1.5 C 9.6 4.2 12.5 5.4 12.5 9 a4.5 4.5 0 0 1-9 0 c0-1.7.8-2.6 1.6-3.6.2 1.2.7 1.9 1.5 2.3C6.1 5.6 6.6 3.4 8 1.5Z" />
      </svg>
    </span>
  );
});
