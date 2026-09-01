"use server";

import { redirect } from "next/navigation";
import { issueSession } from "@/app/login/actions";
import { countUsers, createUser } from "@/lib/users";

function backToSetup(message: string): never {
  redirect(`/setup?error=${encodeURIComponent(message)}`);
}

/**
 * Creates the very first admin account.
 *
 * Only works while the instance has no accounts at all — that window is what
 * makes this page safe to expose without a session. Once one user exists this
 * refuses, so it can never be used to mint a second admin.
 */
export async function completeSetup(formData: FormData): Promise<void> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if ((await countUsers()) > 0) redirect("/login");

  if (password !== confirm) backToSetup("The two passwords do not match.");

  const result = await createUser({ username, password, role: "admin" });
  if (!result.ok) backToSetup(result.error);

  // Sign the new admin straight in — asking them to re-type credentials they
  // set two seconds ago adds nothing.
  await issueSession(result.user);
  redirect("/");
}
