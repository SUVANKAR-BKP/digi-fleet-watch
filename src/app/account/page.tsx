import { redirect } from "next/navigation";
import { ChangePasswordForm } from "@/components/dashboard/change-password-form";
import { getCurrentUser } from "@/lib/auth-server";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export const metadata = { title: "Account" };

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto w-full max-w-md space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Account</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Signed in as <span className="font-mono">{user.username}</span> ·{" "}
          {ROLE_LABELS[user.role]}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {ROLE_DESCRIPTIONS[user.role]}
        </p>
      </div>

      <ChangePasswordForm />
    </div>
  );
}
