import { useId } from "react";
import { cn } from "@/lib/utils";

/** Subcast's mark: a rounded S on a coral gradient, the same artwork as public/icon.svg. */
export function Logo({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 512 512" className={cn("size-7 shrink-0", className)} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FF7A45" />
          <stop offset="1" stopColor="#E5195E" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="116" fill={`url(#${id})`} />
      <path d="M318 160A72 72 0 1 0 256 268A72 72 0 1 1 194 376" fill="none" stroke="#fff" strokeWidth="58" strokeLinecap="round" />
    </svg>
  );
}
