/**
 * Role definitions and permission checks.
 *
 * Pure and dependency-free on purpose: this is imported from middleware (edge
 * runtime), server components, server actions and route handlers alike, so it
 * must not reach for node:crypto or the database.
 */

export type UserRole = "admin" | "operator" | "viewer";

export const USER_ROLES: readonly UserRole[] = ["admin", "operator", "viewer"];

/** What each role is allowed to do. */
export type Permission =
  /** See the dashboard, host detail, packages, containers, uptime. */
  | "hosts:read"
  /** Read AGENT_API_TOKEN via the Add Host dialog — i.e. enrol new hosts. */
  | "hosts:enroll"
  /** Delete a host and its history. */
  | "hosts:delete"
  /** Create, edit, deactivate and remove dashboard accounts. */
  | "users:manage";

const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  // Everything, including handing out access to other people.
  admin: ["hosts:read", "hosts:enroll", "hosts:delete", "users:manage"],
  // Day-to-day fleet work: add and retire hosts, but not manage accounts.
  operator: ["hosts:read", "hosts:enroll", "hosts:delete"],
  // Read-only. Notably cannot read the agent token, which would otherwise let
  // a viewer post arbitrary data as any host.
  viewer: ["hosts:read"],
};

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  operator: "Operator",
  viewer: "Viewer",
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  admin: "Full access, including managing users.",
  operator: "Add and remove hosts. Cannot manage users.",
  viewer: "Read-only. Cannot see the agent token or delete hosts.",
};

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
}

/** True when `role` grants `permission`. */
export function can(role: UserRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/** Permissions granted to a role, for rendering "what can this user do" hints. */
export function permissionsFor(role: UserRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}
