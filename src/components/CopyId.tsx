"use client";

import { useState } from "react";

/** Monospace identifier with copy-to-clipboard (dashboard pattern for transaction ids). */
export function CopyId({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          /* clipboard unavailable */
        }
      }}
      className="num inline-flex items-center gap-1.5 rounded-md border border-line px-1.5 py-0.5 text-[11px] text-ink-2 hover:border-ink-3"
      aria-label={`Copy ${label ?? "id"} ${value}`}
      title="Copy"
    >
      {value}
      <span aria-hidden className="text-ink-3">{copied ? "✓" : "⧉"}</span>
    </button>
  );
}
