import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, authConfigured, verifySession } from "@/lib/dashboard-auth";

/**
 * Gates the dashboard and its read APIs behind the optional shared password.
 * Inert unless FLEETWATCH_DASHBOARD_PASSWORD is set, so existing deployments
 * keep working until their operator opts in.
 */

/**
 * Paths that must stay reachable without a session:
 *  - the agent bootstrap files (public by design, they contain no secrets)
 *  - the agent/cron APIs, which authenticate with AGENT_API_TOKEN instead
 *  - the health probe used by the container healthcheck
 *  - the login page itself
 */
const PUBLIC_PATHS = new Set([
  "/login",
  "/install.sh",
  "/uninstall.sh",
  "/agent.sh",
  "/digi-fleet-watch.service",
  "/digi-fleet-watch.timer",
  "/api/health",
  "/api/ingest",
  "/api/jobs/check-downtime",
]);

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  // Static assets and the app's own icons.
  return (
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/icon.svg"
  );
}

export async function middleware(req: NextRequest) {
  if (!authConfigured()) return NextResponse.next();

  const { pathname, search } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  if (await verifySession(req.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }

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

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
