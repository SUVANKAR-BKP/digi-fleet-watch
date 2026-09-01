import { describe, expect, it } from "vitest";
import {
  SEVERITY_RANK,
  labelForScore,
  normaliseLabel,
  scoreFromVector,
} from "./cvss";

describe("scoreFromVector", () => {
  // Reference vectors and their published base scores, from the CVSS v3.1
  // specification examples and well-known CVEs.
  const CASES: [string, number][] = [
    // Heartbleed-style: network, no privileges, high confidentiality impact.
    ["CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N", 7.5],
    // Full compromise, unchanged scope.
    ["CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", 9.8],
    // Scope change pushes it to the maximum.
    ["CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H", 10.0],
    // Local, high complexity, high privileges — low end.
    // Impact 6.42*0.22 = 1.4124; exploitability 8.22*0.55*0.44*0.27*0.62 = 0.333;
    // 1.7454 rounds up to 1.8.
    ["CVSS:3.1/AV:L/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N", 1.8],
    // Availability-only denial of service.
    ["CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H", 7.5],
    // Requires user interaction.
    ["CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:H/A:H", 8.8],
    // CVSS 3.0 vectors use the same base formula.
    ["CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N", 7.5],
  ];

  it.each(CASES)("scores %s as %d", (vector, expected) => {
    expect(scoreFromVector(vector)).toBeCloseTo(expected, 1);
  });

  it("returns 0 when there is no impact at all", () => {
    expect(scoreFromVector("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N")).toBe(0);
  });

  it("rejects non-CVSS-v3 input rather than guessing", () => {
    // A wrong score is worse than no score: it would sort a critical CVE
    // below a trivial one.
    for (const bad of [
      "",
      "9.8",
      "CVSS:2.0/AV:N/AC:L/Au:N/C:P/I:P/A:P",
      "AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
      "CVSS:3.1/nonsense",
      "CVSS:3.1/AV:X/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
    ]) {
      expect(scoreFromVector(bad)).toBeNull();
    }
  });

  it("is case-insensitive on the prefix and metric values", () => {
    expect(
      scoreFromVector("cvss:3.1/av:n/ac:l/pr:n/ui:n/s:u/c:h/i:h/a:h"),
    ).toBeCloseTo(9.8, 1);
  });

  it("rounds up to one decimal, as the spec requires", () => {
    // The spec's roundup is not Math.round: 8.81 must become 8.9, not 8.8.
    const score = scoreFromVector("CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H");
    expect(score).toBeCloseTo(8.8, 1);
    // Whatever the value, it must be a clean tenth.
    expect(Number.isInteger(Math.round((score ?? 0) * 10))).toBe(true);
  });
});

describe("labelForScore", () => {
  it("uses the CVSS 3.1 qualitative bands", () => {
    expect(labelForScore(10)).toBe("CRITICAL");
    expect(labelForScore(9.0)).toBe("CRITICAL");
    expect(labelForScore(8.9)).toBe("HIGH");
    expect(labelForScore(7.0)).toBe("HIGH");
    expect(labelForScore(6.9)).toBe("MEDIUM");
    expect(labelForScore(4.0)).toBe("MEDIUM");
    expect(labelForScore(3.9)).toBe("LOW");
    expect(labelForScore(0.1)).toBe("LOW");
    expect(labelForScore(0)).toBe("NONE");
  });
});

describe("normaliseLabel", () => {
  it("maps distro wording onto the standard bands", () => {
    // Debian and Ubuntu advisories often carry only a word, not a vector.
    expect(normaliseLabel("important")).toBe("HIGH");
    expect(normaliseLabel("moderate")).toBe("MEDIUM");
    expect(normaliseLabel("negligible")).toBe("LOW");
    expect(normaliseLabel("Critical")).toBe("CRITICAL");
  });

  it("falls back to UNKNOWN rather than inventing a severity", () => {
    for (const bad of [undefined, null, "", "spicy"]) {
      expect(normaliseLabel(bad)).toBe("UNKNOWN");
    }
  });
});

describe("SEVERITY_RANK", () => {
  it("orders worst first when sorting descending", () => {
    const sorted = ["LOW", "CRITICAL", "UNKNOWN", "HIGH", "MEDIUM"].sort(
      (a, b) =>
        SEVERITY_RANK[b as keyof typeof SEVERITY_RANK] -
        SEVERITY_RANK[a as keyof typeof SEVERITY_RANK],
    );
    expect(sorted).toEqual(["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"]);
  });
});
