/**
 * CVSS v3.x base score, computed from the vector string.
 *
 * OSV publishes the vector (`CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H`),
 * not the number. Severity is the entire value of vulnerability data — an
 * unranked list of CVE ids is no more actionable than the package count it
 * replaced — so it is worth computing properly rather than guessing.
 *
 * Formula: https://www.first.org/cvss/v3.1/specification-document#7-1-Base-Metrics
 */

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "NONE" | "UNKNOWN";

const AV = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 } as const;
const AC = { L: 0.77, H: 0.44 } as const;
/** Privileges Required is scope-dependent. */
const PR_UNCHANGED = { N: 0.85, L: 0.62, H: 0.27 } as const;
const PR_CHANGED = { N: 0.85, L: 0.68, H: 0.5 } as const;
const UI = { N: 0.85, R: 0.62 } as const;
const CIA = { H: 0.56, L: 0.22, N: 0 } as const;

/** CVSS rounds *up* to one decimal, which Math.round does not do. */
function roundUp1(value: number): number {
  // Work in integer tenths to dodge binary floating-point drift, which
  // otherwise turns 8.9999999 into 9.0 and bumps a High into a Critical.
  const scaled = Math.round(value * 100000);
  return scaled % 10000 === 0 ? scaled / 100000 : Math.floor(scaled / 10000 + 1) / 10;
}

/** Parses a CVSS v3 vector into a base score, or null if it is not one. */
export function scoreFromVector(vector: string): number | null {
  if (!/^CVSS:3\.[01]\//i.test(vector)) return null;

  const parts = new Map<string, string>();
  for (const segment of vector.split("/").slice(1)) {
    const [key, value] = segment.split(":");
    if (key && value) parts.set(key.toUpperCase(), value.toUpperCase());
  }

  const scopeChanged = parts.get("S") === "C";
  const av = AV[parts.get("AV") as keyof typeof AV];
  const ac = AC[parts.get("AC") as keyof typeof AC];
  const pr = (scopeChanged ? PR_CHANGED : PR_UNCHANGED)[
    parts.get("PR") as keyof typeof PR_UNCHANGED
  ];
  const ui = UI[parts.get("UI") as keyof typeof UI];
  const c = CIA[parts.get("C") as keyof typeof CIA];
  const i = CIA[parts.get("I") as keyof typeof CIA];
  const a = CIA[parts.get("A") as keyof typeof CIA];

  if ([av, ac, pr, ui, c, i, a].some((v) => v === undefined)) return null;

  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  const impact = scopeChanged
    ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15)
    : 6.42 * iss;

  if (impact <= 0) return 0;

  const exploitability = 8.22 * av * ac * pr * ui;
  const raw = scopeChanged
    ? Math.min(1.08 * (impact + exploitability), 10)
    : Math.min(impact + exploitability, 10);

  return roundUp1(raw);
}

/** Qualitative rating for a base score, per the CVSS 3.1 spec. */
export function labelForScore(score: number): Severity {
  if (score >= 9.0) return "CRITICAL";
  if (score >= 7.0) return "HIGH";
  if (score >= 4.0) return "MEDIUM";
  if (score > 0) return "LOW";
  return "NONE";
}

/** Normalises a textual severity from a distro advisory. */
export function normaliseLabel(raw: string | undefined | null): Severity {
  switch (raw?.toUpperCase().trim()) {
    case "CRITICAL":
      return "CRITICAL";
    case "HIGH":
    case "IMPORTANT":
      return "HIGH";
    case "MEDIUM":
    case "MODERATE":
      return "MEDIUM";
    case "LOW":
    case "NEGLIGIBLE":
      return "LOW";
    case "NONE":
      return "NONE";
    default:
      return "UNKNOWN";
  }
}

/** Ordering for "worst first" listings. */
export const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  NONE: 1,
  UNKNOWN: 0,
};
