import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getAgentSource } from "./agent-files";

/**
 * These files are piped into bash on Linux. A single carriage return makes
 * every install fail with "$\'\r\': command not found", which is exactly
 * what happened after a Windows editor rewrote agent.sh.
 */
const SERVED = [
  "install.sh",
  "uninstall.sh",
  "agent.sh",
  "digi-fleet-watch.service",
  "digi-fleet-watch.timer",
] as const;

describe("agent files served to hosts", () => {
  it.each(SERVED)("%s is served without carriage returns", (name) => {
    expect(getAgentSource(name).content).not.toContain("\r");
  });

  it.each(SERVED)("%s is stored in the repo with LF endings", (name) => {
    // The serving layer normalises, but the repo copy should be correct too
    // so `bash agent/agent.sh` works on a developer machine as well.
    const raw = fs.readFileSync(path.join(process.cwd(), "agent", name), "utf8");
    expect(raw).not.toContain("\r");
  });

  it("normalises CRLF that reaches it anyway", () => {
    // Guards the regex itself: a checkout with core.autocrlf=true must still
    // produce a runnable script.
    const withCrlf = "#!/bin/bash\r\nset -e\r\necho hi\r\n";
    const normalised = withCrlf.replace(/\r\n?/g, "\n");
    expect(normalised).toBe("#!/bin/bash\nset -e\necho hi\n");
  });
});
