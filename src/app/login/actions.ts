"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE,
  authConfigured,
  createSession,
  passwordMatches,
} from "@/lib/dashboard-auth";

/** Only same-site absolute paths, so `?next=` cannot bounce to another origin. */
function safeNext(next: string): string {
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

export async function login(formData: FormData): Promise<void> {
  const password = String(formData.get("password") ?? "");
  const next = safeNext(String(formData.get("next") ?? "/"));

  // Nothing to log into when the gate is disabled.
  if (!authConfigured()) redirect("/");

  if (!passwordMatches(password)) {
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  }

  const { value, maxAge } = await createSession();
  // `secure` is derived from the actual scheme rather than NODE_ENV: this app
  // is commonly reached over plain http://<ip>:3000, and a Secure cookie there
  // is silently dropped by the browser, producing an endless login loop.
  const proto = (await headers()).get("x-forwarded-proto") ?? "http";

  (await cookies()).set(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge,
    secure: proto === "https",
  });

  redirect(next);
}
