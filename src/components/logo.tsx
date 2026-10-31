import { cn } from "@/lib/utils";

export function Logo({
  className,
  tone = "auto",
  showMark = true,
}: {
  className?: string;
  tone?: "auto" | "light" | "dark";
  showMark?: boolean;
}) {
  const text =
    tone === "light" ? "text-white" : tone === "dark" ? "text-black" : "text-foreground";
  const markStroke = tone === "light" ? "#fff" : tone === "dark" ? "#000" : "currentColor";
  return (
    <span className={cn("inline-flex items-center gap-2.5", text, className)}>
      {showMark && (
        <svg width="22" height="22" viewBox="0 0 64 64" aria-hidden="true" className="shrink-0">
          <rect width="64" height="64" fill={tone === "light" ? "#fff" : "#0a0a0a"} />
          <path
            d="M20 15v34M20 32l17-17M20 32l19 17"
            stroke={tone === "light" ? "#0a0a0a" : "#fff"}
            strokeWidth="5.5"
            strokeLinecap="square"
          />
          <circle cx="47" cy="47" r="4" fill="#eca8d6" />
        </svg>
      )}
      <span className="font-display text-[1.35em] leading-none tracking-tight">KEEL</span>
      <span className="font-mono text-[9px] leading-none opacity-50 -translate-y-1.5">TM</span>
    </span>
  );
}
