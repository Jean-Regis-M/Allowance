"use client";

import { useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type ICellRendererParams } from "ag-grid-community";
import type { LedgerEntry } from "@/lib/ledger";

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
  fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
  fontSize: 13,
  backgroundColor: "#fffdf9",
  foregroundColor: "#1c1b18",
  headerTextColor: "#57534b",
  borderColor: "#e4ded3",
  accentColor: "#1f5f4a",
  oddRowBackgroundColor: "#fbf8f3",
  wrapperBorderRadius: 14,
  headerFontWeight: 600,
  spacing: 7,
});

const ACTOR: Record<string, { label: string; cls: string }> = {
  owner: { label: "Owner", cls: "bg-[#ece7de] text-ink" },
  agent: { label: "AI agent", cls: "bg-allow-bg text-allow" },
  policy: { label: "Firewall", cls: "bg-wait-bg text-wait" },
  paypal: { label: "PayPal Braintree", cls: "bg-pay-bg text-pay" },
  system: { label: "System", cls: "bg-[#ece7de] text-ink-3" },
};

function ActorCell(p: ICellRendererParams<LedgerEntry>) {
  const a = ACTOR[p.value as string] ?? ACTOR.system;
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${a.cls}`}>{a.label}</span>;
}

function SummaryCell(p: ICellRendererParams<LedgerEntry>) {
  const blocked = p.data?.type === "policy.blocked";
  return <span className={blocked ? "text-block font-medium" : ""}>{p.value as string}</span>;
}

export function LedgerGrid({ entries, height = 420, showMandate = false }: { entries: LedgerEntry[]; height?: number; showMandate?: boolean }) {
  const [quick, setQuick] = useState("");
  const cols = useMemo<ColDef<LedgerEntry>[]>(
    () => [
      { field: "seq", headerName: "#", width: 70, sort: "desc", cellClass: "num" },
      { field: "at", headerName: "Time", width: 132, valueFormatter: (p) => new Date(p.value as string).toLocaleTimeString(), cellClass: "num" },
      { field: "actor", headerName: "Actor", width: 150, cellRenderer: ActorCell, filter: true },
      ...(showMandate ? [{ field: "mandateId", headerName: "Mandate", width: 150, cellClass: "num", filter: true } as ColDef<LedgerEntry>] : []),
      { field: "type", headerName: "Event", width: 180, cellClass: "num", filter: true },
      { field: "summary", headerName: "What happened", flex: 1, minWidth: 280, cellRenderer: SummaryCell, wrapText: true, autoHeight: true, cellStyle: { lineHeight: "1.45", paddingTop: "9px", paddingBottom: "9px" } },
      { field: "hash", headerName: "Chained hash", width: 150, valueFormatter: (p) => `${String(p.value).slice(0, 12)}…`, cellClass: "num text-ink-3", tooltipField: "hash" },
    ],
    [showMandate],
  );

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2">
        <label className="sr-only" htmlFor="ledger-q">Filter ledger</label>
        <input
          id="ledger-q"
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          placeholder="Filter: blocked, PayPal, refund…"
          className="w-full max-w-xs rounded-lg border border-line-2 bg-card px-3 py-1.5 text-sm outline-none focus:border-ink"
        />
        <span className="text-xs text-ink-3 num">{entries.length} events</span>
      </div>
      <div style={{ height }}>
        <AgGridReact<LedgerEntry>
          theme={theme}
          rowData={entries}
          columnDefs={cols}
          quickFilterText={quick}
          getRowId={(p) => String(p.data.seq)}
          defaultColDef={{ resizable: true, sortable: true }}
          animateRows
          tooltipShowDelay={300}
          overlayNoRowsTemplate="<span style='color:#8c867b'>No events yet</span>"
        />
      </div>
    </div>
  );
}
