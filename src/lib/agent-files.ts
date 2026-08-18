import fs from "node:fs";
import path from "node:path";

/**
 * Maps agent artifact filename -> Content-Type. These are the files served
 * directly to a target host so it can bootstrap itself without transferring
 * anything manually.
 */
const AGENT_FILES = {
  "install.sh": "text/x-shellscript; charset=utf-8",
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
  const content = fs.readFileSync(file, "utf8");
  return { content, type: AGENT_FILES[name] };
}