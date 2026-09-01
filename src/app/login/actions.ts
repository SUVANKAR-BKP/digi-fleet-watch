"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, createSession } from "@/lib/session";
import { verifyLogin } from "@/lib/users";

/** Only same-site absolute paths, so `?next=` cannot bounce to another origin. */
function safeNext(next: string): string {
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

/**
 * Writes the session cookie.
 *
 * `secure` is derived from the actual scheme rather than NODE_ENV: this app is
 * commonly reached over plain http://<ip>:3000, where a Secure cookie is
 * silently dropped by the browser, producing an endless login loop.
 */
export async function issueSession(user: {
  id: number;
  username: string;
  role: "admin" | "operator" | "viewer";
}): Promise<void> {
  const { value, maxAge } = await createSession(user);
  const proto = (await headers()).get("x-forwarded-proto") ?? "http";

  (await cookies()).set(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge,
    secure: proto === "https",
  });
}

export async function login(formData: FormData): Promise<void> {
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = safeNext(String(formData.get("next") ?? "/"));

  const fail = () =>
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`);

  if (!username || !password) fail();

  const user = await verifyLogin(username, password);
  // Deliberately one message for unknown user, wrong password and disabled
  // account — anything else turns this form into an account oracle.
  if (!user) fail();

  await issueSession(user!);
  redirect(next);
}

export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
