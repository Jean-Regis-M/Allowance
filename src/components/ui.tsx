import type { MandateStatus } from "@/lib/domain";

export const usd = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

const STATUS: Record<MandateStatus, { label: string; cls: string }> = {
  DRAFT: { label: "Draft", cls: "bg-[#ece7de] text-ink-2" },
  AWAITING_FUNDING: { label: "Authorizing…", cls: "bg-pay-bg text-pay" },
  ACTIVE: { label: "Funded", cls: "bg-pay-bg text-pay" },
  SHOPPING: { label: "Agent working", cls: "bg-allow-bg text-allow" },
  NEEDS_APPROVAL: { label: "Needs your OK", cls: "bg-wait-bg text-wait" },
  SETTLED: { label: "Paid", cls: "bg-allow-bg text-allow" },
  CANCELLED: { label: "Cancelled", cls: "bg-[#ece7de] text-ink-3" },
  EXPIRED: { label: "Expired", cls: "bg-[#ece7de] text-ink-3" },
};

export function StatusPill({ status }: { status: MandateStatus }) {
  const s = STATUS[status];
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.cls}`}>{s.label}</span>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2" role="status">
      <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" fill="none" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
      </svg>
      {label && <span>{label}</span>}
    </span>
  );
}

export function ErrorNote({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-[#e3b9b0] bg-block-bg px-4 py-3 text-sm text-block flex items-start gap-3">
      <span className="font-semibold shrink-0">Something went wrong.</span>
      <span className="text-ink-2 flex-1 break-words">{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="text-ink-3 hover:text-ink" aria-label="Dismiss error">
          ✕
        </button>
      )}
    </div>
  );
}

export const CATEGORY_LABEL: Record<string, string> = {
  "dairy-alternatives": "Dairy alternatives",
  packaging: "Packaging",
  coffee: "Coffee",
  "equipment-care": "Equipment care",
  cleaning: "Cleaning",
};

export const MERCHANT_LABEL: Record<string, string> = {
  m_greenleaf: "Greenleaf Dairy Alternatives",
  m_packright: "PackRight Supplies",
  m_beanworks: "Beanworks Roasters",
  m_cleanco: "CleanCo Janitorial",
  m_slowboat: "Slowboat Wholesale",
  m_dealzzz: "DEALZZZ Overstock",
};

export const VIOLATION_LABEL: Record<string, string> = {
  MANDATE_NOT_ACTIVE: "Mandate not funded",
  MANDATE_EXPIRED: "Mandate expired",
  EMPTY_CART: "Empty cart",
  UNKNOWN_PRODUCT: "Unknown product",
  INVALID_QUANTITY: "Invalid quantity",
  QUANTITY_LIMIT: "Over quantity limit",
  OUT_OF_STOCK: "Out of stock",
  CATEGORY_NOT_ALLOWED: "Category not allowed",
  MERCHANT_NOT_ALLOWED: "Supplier not approved",
  MERCHANT_UNVERIFIED: "Unverified merchant",
  DELIVERY_TOO_SLOW: "Misses deadline",
  ITEM_OVER_LIMIT: "Over per-item limit",
  OVER_BUDGET: "Over budget",
  DUPLICATE_LINE: "Duplicate line",
};
