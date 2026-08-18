"use client";

import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Search,
  ShieldAlert,
} from "lucide-react";
import type { PackageRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

type SortKey = "name" | "installed" | "available";

export function PackageTable({ packages }: { packages: PackageRow[] }) {
  const [query, setQuery] = useState("");
  const [securityOnly, setSecurityOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const rows = useMemo(() => {
    let out = packages;
    if (securityOnly) out = out.filter((p) => p.security);
    const q = query.trim().toLowerCase();
    if (q) out = out.filter((p) => p.name.toLowerCase().includes(q));

    const sorted = [...out].sort((a, b) => {
      const val = (p: PackageRow, key: SortKey): string => {
        if (key === "name") return p.name;
        if (key === "installed") return p.installed;
        return p.available ?? "";
      };
      const cmp = val(a, sortKey).localeCompare(val(b, sortKey));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [packages, query, securityOnly, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const SortIcon = (key: SortKey) => {
    if (key !== sortKey) return <ArrowUpDown className="h-3 w-3 opacity-50" />;
    return sortDir === "asc" ? (
      <ArrowUp className="h-3 w-3" />
    ) : (
      <ArrowDown className="h-3 w-3" />
    );
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter packages…"
            className="h-8 w-52 pl-8 text-xs"
          />
        </div>
        <button
          type="button"
          onClick={() => setSecurityOnly((v) => !v)}
          aria-pressed={securityOnly}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
            securityOnly
              ? "border-security/60 bg-security/15 text-security"
              : "border-border bg-secondary text-muted-foreground hover:text-foreground",
          )}
        >
          <ShieldAlert className="h-3.5 w-3.5" />
          Security only
        </button>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {rows.length} of {packages.length}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[560px] text-left text-xs">
          <thead>
            <tr className="border-b border-border bg-secondary/50 text-[11px] uppercase tracking-wider text-muted-foreground">
              <Th onClick={() => toggleSort("name")}>
                Package {SortIcon("name")}
              </Th>
              <Th onClick={() => toggleSort("installed")}>
                Installed {SortIcon("installed")}
              </Th>
              <Th onClick={() => toggleSort("available")}>
                Available {SortIcon("available")}
              </Th>
              <Th>Security / CVEs</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-3 py-8 text-center text-muted-foreground"
                >
                  No packages match the current filter.
                </td>
              </tr>
            ) : (
              rows.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-border/60 last:border-0 hover:bg-secondary/40"
                >
                  <td className="px-3 py-2 font-mono font-medium text-foreground">
                    {p.name}
                  </td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">
                    {p.installed}
                  </td>
                  <td className="px-3 py-2 font-mono text-foreground">
                    {p.available ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    {p.security ? (
                      <span className="inline-flex items-center gap-1 rounded border border-security/50 bg-security/10 px-1.5 py-0.5 font-medium text-security">
                        <ShieldAlert className="h-3 w-3" />
                        {p.cveIds.length > 0 ? p.cveIds.join(", ") : "security"}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <th>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="inline-flex w-full items-center gap-1 px-3 py-2 text-left font-semibold uppercase tracking-wider"
        >
          {children}
        </button>
      ) : (
        <span className="inline-flex w-full items-center gap-1 px-3 py-2 text-left font-semibold uppercase tracking-wider">
          {children}
        </span>
      )}
    </th>
  );
}