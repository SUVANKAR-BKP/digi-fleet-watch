import { NextResponse, type NextRequest } from "next/server";
import { can } from "@/lib/rbac";
import { SESSION_COOKIE, readSession } from "@/lib/session";

/**
 * Gates the dashboard behind a signed-in account.
 *
 * Runs on the edge runtime, so it can only inspect the signed cookie — it
 * cannot reach Postgres. That is enough for coarse routing (signed in? admin?);
 * pages and server actions re-check the live user record via auth-server.ts.
 *
 * Whether any account exists is likewise unknowable here, so an unauthenticated
 * request always goes to /login, and /login itself redirects on to /setup when
 * the instance has no users yet.
 */

/**
 * Paths that must stay reachable without a session:
 *  - the first-run setup flow and the login page
 *  - the agent bootstrap files (public by design, no secrets inside)
 *  - the agent/cron APIs, which authenticate with AGENT_API_TOKEN instead
 *  - the health probe used by the container healthcheck
 */
const PUBLIC_PATHS = new Set([
  "/login",
  "/setup",
  "/install.sh",
  "/uninstall.sh",
  "/agent.sh",
  "/digi-fleet-watch.service",
  "/digi-fleet-watch.timer",
  "/api/health",
  "/api/ingest",
  "/api/jobs/check-downtime",
]);

/** Routes that additionally require a specific permission. */
const ADMIN_PATH_PREFIX = "/users";

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return (
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/icon.svg"
  );
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);

  if (!session) {
    // APIs get a status code; humans get the login form.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const login = req.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }

  if (pathname === ADMIN_PATH_PREFIX || pathname.startsWith(`${ADMIN_PATH_PREFIX}/`)) {
    if (!can(session.role, "users:manage")) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      const home = req.nextUrl.clone();
      home.pathname = "/";
      home.search = "";
      return NextResponse.redirect(home);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
