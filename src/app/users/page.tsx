import { redirect } from "next/navigation";
import { UserTable } from "@/components/dashboard/user-table";
import { getCurrentUser } from "@/lib/auth-server";
import { can, ROLE_DESCRIPTIONS, ROLE_LABELS, USER_ROLES } from "@/lib/rbac";
import { listUsers } from "@/lib/users";

export const dynamic = "force-dynamic";

export const metadata = { title: "Users" };

export default async function UsersPage() {
  const user = await getCurrentUser();
  // Middleware already gates /users on the cookie's role; this re-check uses
  // the live record, so a just-demoted admin cannot linger here.
  if (!user) redirect("/login");
  if (!can(user.role, "users:manage")) redirect("/");

  const users = await listUsers();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Users</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {users.length} {users.length === 1 ? "account" : "accounts"} with access
          to this dashboard.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {USER_ROLES.map((r) => (
          <div key={r} className="rounded-lg border border-border bg-card p-3">
            <p className="text-xs font-semibold">{ROLE_LABELS[r]}</p>
            <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
              {ROLE_DESCRIPTIONS[r]}
            </p>
          </div>
        ))}
      </div>

      <UserTable users={users} currentUserId={user.id} />
    </div>
  );
}
