// Pure helpers for building the one-liner install command. This module has no
// server-only imports so it can be used from both server components and the
// client-side Add Host dialog.

/** Mask a secret, showing only the first/last 4 characters. */
export function maskToken(token: string): string {
  if (!token) return "••••••••";
  if (token.length <= 8) return "••••••••";
  return `${token.slice(0, 4)}••••••••${token.slice(-4)}`;
}

/** Escape a value so it is safe inside double quotes in the command. */
export function escapeShellDouble(value: string): string {
  return value.replace(/["\\]/g, "\\$&").replace(/\r?\n/g, " ").trim();
}

/**
 * Build the copy-paste install command:
 *
 *   curl -fsSL <base>/install.sh | \
 *     AGENT_API_TOKEN=<token> \
 *     FLEETWATCH_LABEL="<label>" \     (only when label is set)
 *     FLEETWATCH_URL=<base> \
 *     bash
 */
export function buildInstallCommand(
  baseUrl: string,
  token: string,
  label: string,
): string {
  const lines = [`curl -fsSL ${baseUrl}/install.sh | \\`];
  lines.push(`  AGENT_API_TOKEN=${token} \\`);
  const trimmed = label.trim();
  if (trimmed) {
    lines.push(`  FLEETWATCH_LABEL="${escapeShellDouble(trimmed)}" \\`);
  }
  lines.push(`  FLEETWATCH_URL=${baseUrl} \\`, "  bash");
  return lines.join("\n");
}