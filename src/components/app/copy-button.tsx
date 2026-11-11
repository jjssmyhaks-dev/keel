"use client";

import { useState } from "react";

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for browsers that block the async clipboard API.
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}

export function CopyButton({
  value,
  label = "Copy",
  className = "",
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        const ok = await copyText(value);
        setCopied(ok);
        if (ok) setTimeout(() => setCopied(false), 1500);
      }}
      className={
        className ||
        "border border-black/45 bg-white px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-black/60 transition-colors hover:border-black hover:text-black dark:border-white/40 dark:bg-card dark:text-muted-foreground dark:hover:text-foreground"
      }
    >
      {copied ? "Copied" : label}
    </button>
  );
}
