import { describe, expect, it } from "vitest";
import { USER_ROLES, can, isUserRole, permissionsFor } from "./rbac";

describe("can", () => {
  it("lets every role read hosts", () => {
    for (const role of USER_ROLES) {
      expect(can(role, "hosts:read")).toBe(true);
    }
  });

  it("only lets admins manage users", () => {
    expect(can("admin", "users:manage")).toBe(true);
    expect(can("operator", "users:manage")).toBe(false);
    expect(can("viewer", "users:manage")).toBe(false);
  });

  it("keeps the agent token away from viewers", () => {
    // The token can post data as any host, so read-only accounts must not see
    // it — this is the check behind the Add Host dialog.
    expect(can("admin", "hosts:enroll")).toBe(true);
    expect(can("operator", "hosts:enroll")).toBe(true);
    expect(can("viewer", "hosts:enroll")).toBe(false);
  });

  it("does not let viewers delete hosts", () => {
    expect(can("admin", "hosts:delete")).toBe(true);
    expect(can("operator", "hosts:delete")).toBe(true);
    expect(can("viewer", "hosts:delete")).toBe(false);
  });

  it("denies when the role is missing", () => {
    // getCurrentUser() returns null when signed out or when the database is
    // unreachable; that must fail closed.
    expect(can(null, "hosts:read")).toBe(false);
    expect(can(undefined, "hosts:read")).toBe(false);
  });
});

describe("isUserRole", () => {
  it("accepts the three known roles", () => {
    for (const role of USER_ROLES) expect(isUserRole(role)).toBe(true);
  });

  it("rejects anything else, including privilege-escalation attempts", () => {
    // Role arrives from a form field, so this guard is load-bearing.
    for (const bad of ["superadmin", "ADMIN", "", null, undefined, 1, {}]) {
      expect(isUserRole(bad)).toBe(false);
    }
  });
});

describe("permissionsFor", () => {
  it("gives admin strictly more than operator, and operator more than viewer", () => {
    const admin = permissionsFor("admin");
    const operator = permissionsFor("operator");
    const viewer = permissionsFor("viewer");

    expect(admin.length).toBeGreaterThan(operator.length);
    expect(operator.length).toBeGreaterThan(viewer.length);
    for (const p of operator) expect(admin).toContain(p);
    for (const p of viewer) expect(operator).toContain(p);
  });
});
