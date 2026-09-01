import fs from "node:fs";
import path from "node:path";

/**
 * Maps agent artifact filename -> Content-Type. These are the files served
 * directly to a target host so it can bootstrap itself without transferring
 * anything manually.
 */
const AGENT_FILES = {
  "install.sh": "text/x-shellscript; charset=utf-8",
  "uninstall.sh": "text/x-shellscript; charset=utf-8",
  "agent.sh": "text/x-shellscript; charset=utf-8",
  "digi-fleet-watch.service": "text/plain; charset=utf-8",
  "digi-fleet-watch.timer": "text/plain; charset=utf-8",
} as const;

export type AgentFile = keyof typeof AGENT_FILES;

/**
 * Reads an agent file from the repo. In the Docker standalone image the
 * `agent/` directory is copied into the runner (see Dockerfile), so
 * `process.cwd()/agent` exists there too.
 */
export function getAgentSource(name: AgentFile): {
  content: string;
  type: string;
} {
  const file = path.join(process.cwd(), "agent", name);
  const raw = fs.readFileSync(file, "utf8");
  return { content: toUnixNewlines(raw), type: AGENT_FILES[name] };
}

/**
 * Forces LF endings on anything served to a host.
 *
 * These files are piped straight into `bash` on Linux, where a stray carriage
 * return is fatal rather than cosmetic: bash reads it as part of the command
 * and fails with "$\'\r\': command not found", then a syntax error on the
 * next brace. One edit from a Windows editor (or a checkout with
 * core.autocrlf=true) is enough to break every install.
 *
 * .gitattributes pins the endings in the repository; this makes the server
 * correct even if the working copy it was built from was not.
 */
function toUnixNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}
