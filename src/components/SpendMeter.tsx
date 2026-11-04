import type { Mandate } from "@/lib/domain";
import { usd } from "./ui";

/**
 * Spend meter (pattern from corporate-card limit bars): budget held vs spent vs released.
 */
export function SpendMeter({ mandate, compact = false }: { mandate: Mandate; compact?: boolean }) {
  const budget = mandate.rules.budget || 1;
  const held = mandate.authorizedAmount;
  const spent = mandate.order?.total ?? 0;
  const pending = mandate.pendingCart?.total ?? 0;
  const released = mandate.status === "SETTLED" ? held - spent : mandate.status === "CANCELLED" ? held : 0;
  const pct = (n: number) => `${Math.min(100, Math.max(0, (n / budget) * 100))}%`;

  const label =
    mandate.status === "DRAFT" ? "Not funded yet"
    : mandate.status === "CANCELLED" ? "Hold released"
    : mandate.status === "SETTLED" ? `${usd(spent)} spent · ${usd(released)} released`
    : pending ? `${usd(pending)} awaiting your approval`
    : `${usd(held - spent)} available to the agent`;

  return (
    <div>
      {!compact && (
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-ink-3">Allowance</span>
          <span className="num text-ink-2">
            {usd(spent || pending)} <span className="text-ink-3">of {usd(budget)}</span>
          </span>
        </div>
      )}
      <div
        className={`relative ${compact ? "h-1.5" : "h-2.5 mt-1.5"} rounded-full bg-[#ece7de] overflow-hidden`}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={budget}
        aria-valuenow={spent || pending}
        aria-label={label}
      >
        {held > 0 && mandate.status !== "CANCELLED" && <div className="absolute inset-y-0 left-0 bg-pay/15" style={{ width: pct(held) }} />}
        {pending > 0 && <div className="absolute inset-y-0 left-0 bg-wait" style={{ width: pct(pending) }} />}
        {spent > 0 && <div className="absolute inset-y-0 left-0 bg-allow" style={{ width: pct(spent) }} />}
      </div>
      {!compact && <p className="text-xs text-ink-3 mt-1.5">{label}</p>}
    </div>
  );
}

const STEPS = ["Describe", "Fund", "Delegate", "Settle"] as const;

export function Stepper({ mandate }: { mandate: Mandate }) {
  const idx =
    mandate.status === "DRAFT" || mandate.status === "AWAITING_FUNDING" ? 1
    : mandate.status === "ACTIVE" || mandate.status === "SHOPPING" ? 2
    : mandate.status === "NEEDS_APPROVAL" ? 3
    : 4;
  const cancelled = mandate.status === "CANCELLED";
  return (
    <ol className="flex items-center gap-2 text-xs" aria-label="Mandate progress">
      {STEPS.map((s, i) => {
        const done = !cancelled && i < idx;
        const current = !cancelled && i === idx;
        return (
          <li key={s} className="flex items-center gap-2">
            <span
              className={`grid place-items-center size-5 rounded-full text-[10px] font-semibold ${
                done ? "bg-allow text-white" : current ? "bg-ink text-paper" : "bg-[#ece7de] text-ink-3"
              }`}
              aria-hidden
            >
              {done ? "✓" : i + 1}
            </span>
            <span className={current ? "font-semibold text-ink" : done ? "text-ink-2" : "text-ink-3"} aria-current={current ? "step" : undefined}>
              {s}
            </span>
            {i < STEPS.length - 1 && <span className="w-6 sm:w-10 h-px bg-line-2" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
