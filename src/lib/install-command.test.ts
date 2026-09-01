import { describe, expect, it } from "vitest";
import {
  buildInstallCommand,
  escapeShellDouble,
  maskToken,
  sanitizeLabel,
} from "./install-command";

const BASE = "http://135.125.236.47:3000";
const TOKEN = "6c7d3502f4ec7d4f61379d694fc7b464cc9f969b7b8797626abea35b1b5a12dd";

describe("sanitizeLabel", () => {
  it("keeps ordinary human labels intact", () => {
    expect(sanitizeLabel("Own server")).toBe("Own server");
    expect(sanitizeLabel("prod-gitlab")).toBe("prod-gitlab");
    expect(sanitizeLabel("proxmox_node.2")).toBe("proxmox_node.2");
  });

  it("strips shell metacharacters", () => {
    // agent.sh sources the env file, so these would otherwise execute.
    expect(sanitizeLabel("x; touch /tmp/pwned")).toBe("x touch tmppwned");
    expect(sanitizeLabel("$(id)")).toBe("id");
    expect(sanitizeLabel("`id`")).toBe("id");
    expect(sanitizeLabel("a|b&c>d<e")).toBe("abcde");
  });

  it("removes quotes that could terminate the quoting", () => {
    expect(sanitizeLabel("a\'b")).toBe("ab");
    expect(sanitizeLabel('a\"b')).toBe("ab");
  });

  it("collapses whitespace and newlines to single spaces", () => {
    expect(sanitizeLabel("a\n\nb")).toBe("a b");
    expect(sanitizeLabel("  padded   out  ")).toBe("padded out");
  });

  it("caps the length", () => {
    expect(sanitizeLabel("a".repeat(500))).toHaveLength(200);
  });
});

describe("escapeShellDouble", () => {
  it("escapes command substitution, not just quotes", () => {
    // Inside double quotes a shell still expands $(...) and backticks, so an
    // unescaped one would run in the operator root shell on paste.
    expect(escapeShellDouble("$(id)")).toBe("\\$(id)");
    expect(escapeShellDouble("`id`")).toBe("\\`id\\`");
    expect(escapeShellDouble('say \"hi\"')).toBe('say \\\"hi\\\"');
  });
});

describe("buildInstallCommand", () => {
  it("omits the label line when there is no label", () => {
    const cmd = buildInstallCommand(BASE, TOKEN, "   ");
    expect(cmd).not.toContain("FLEETWATCH_LABEL");
    expect(cmd).toContain(`AGENT_API_TOKEN=${TOKEN}`);
  });

  it("quotes a label containing spaces", () => {
    // The bug this guards: an unquoted `FLEETWATCH_LABEL=Own server` made the
    // agent env file run `server` and left the label empty.
    const cmd = buildInstallCommand(BASE, TOKEN, "Own server");
    expect(cmd).toContain(`FLEETWATCH_LABEL="Own server"`);
  });

  it("never emits a command substitution", () => {
    // sanitizeLabel strips `$`, `(` and `/` outright, so nothing survives that
    // the operator's root shell could expand on paste.
    const cmd = buildInstallCommand(BASE, TOKEN, "$(touch /tmp/pwned)");
    expect(cmd).not.toContain("$(");
    expect(cmd).not.toContain("`");
    expect(cmd).not.toContain("/tmp/pwned");
  });

  it("never emits a shell separator that could chain a command", () => {
    const cmd = buildInstallCommand(BASE, TOKEN, "web-01; rm -rf /");
    expect(cmd).toContain(`FLEETWATCH_LABEL="web-01 rm -rf"`);
    expect(cmd).not.toContain(";");
  });

  it("keeps the token verbatim so the command actually works", () => {
    expect(buildInstallCommand(BASE, TOKEN, "x")).toContain(TOKEN);
  });
});

describe("maskToken", () => {
  it("shows only the ends of a real token", () => {
    const masked = maskToken(TOKEN);
    expect(masked.startsWith("6c7d")).toBe(true);
    expect(masked.endsWith("12dd")).toBe(true);
    expect(masked).not.toContain(TOKEN.slice(8, 40));
  });

  it("does not half-reveal a short or empty token", () => {
    expect(maskToken("")).toBe("••••••••");
    expect(maskToken("abc")).toBe("••••••••");
  });
});

describe("sanitizeLabel parity with install.sh", () => {
  // These expectations were produced by running the shell pipeline in
  // agent/install.sh over the same inputs. The dialog previews the label and
  // install.sh stores it, so the two must not disagree — otherwise the host
  // ends up named something other than what the operator was shown.
  const CASES: [string, string][] = [
    ["Own server", "Own server"],
    ["prod-gitlab", "prod-gitlab"],
    ["proxmox_node.2", "proxmox_node.2"],
    ["x; touch /tmp/pwned", "x touch tmppwned"],
    ["a\n\nb", "a b"],
    ["  padded   out  ", "padded out"],
    ["web-01; rm -rf /", "web-01 rm -rf"],
  ];

  it.each(CASES)("%j -> %j", (input, expected) => {
    expect(sanitizeLabel(input)).toBe(expected);
  });
});
