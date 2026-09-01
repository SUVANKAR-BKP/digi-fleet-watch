// Pure helpers for building the one-liner install command. This module has no
// server-only imports so it can be used from both server components and the
// client-side Add Host dialog.

/** Mask a secret, showing only the first/last 4 characters. */
export function maskToken(token: string): string {
  if (!token) return "••••••••";
  if (token.length <= 8) return "••••••••";
  return `${token.slice(0, 4)}••••••••${token.slice(-4)}`;
}

/**
 * Reduces a host label to the characters that survive the whole pipeline.
 *
 * The label travels a long way: typed here, pasted into a root shell as
 * `FLEETWATCH_LABEL="…"`, written by install.sh into /etc/digi-fleet-watch/
 * agent.env, and finally *sourced as shell* by agent.sh on every run. Each hop
 * is a chance for a stray character to change meaning — a space alone used to
 * silently blank the label, and `$(…)` or `;` would have executed.
 *
 * install.sh applies exactly this allowlist before storing the value, so what
 * the dialog shows is what the host ends up with. Keeping the two in sync
 * matters more than accepting exotic labels.
 */
export function sanitizeLabel(label: string): string {
  return (
    label
      // Whitespace becomes a space *before* the allowlist runs. Filtering
      // first would delete newlines outright, silently welding "a\n\nb" into
      // "ab" instead of "a b".
      .replace(/\s+/g, " ")
      .replace(/[^A-Za-z0-9 ._-]/g, "")
      // Removals can leave runs of spaces behind ("a ; b" -> "a  b").
      .replace(/ +/g, " ")
      .slice(0, 200)
      .trim()
  );
}

/**
 * Escape a value so it is safe inside double quotes in the command.
 *
 * `$` and backtick are escaped too, not just `"` and `\`: inside double quotes
 * a shell still performs command substitution, so an unescaped `$(…)` would run
 * in the operator's root shell the moment they pasted the command.
 */
export function escapeShellDouble(value: string): string {
  return value.replace(/(["\\$`])/g, "\\$1").replace(/\r?\n/g, " ").trim();
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

  const clean = sanitizeLabel(label);
  if (clean) {
    lines.push(`  FLEETWATCH_LABEL="${escapeShellDouble(clean)}" \\`);
  }
  lines.push(`  FLEETWATCH_URL=${baseUrl} \\`, "  bash");
  return lines.join("\n");
}
