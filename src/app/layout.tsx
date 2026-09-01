import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { AddHostDialog } from "@/components/dashboard/add-host-dialog";
import { Logo } from "@/components/dashboard/logo";
import { UserMenu } from "@/components/dashboard/user-menu";
import { getCurrentUser } from "@/lib/auth-server";
import { getInstallContext } from "@/lib/install-context";
import { can } from "@/lib/rbac";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Digi Fleet Watch",
    template: "%s · Digi Fleet Watch",
  },
  description:
    "Digi Fleet Watch — self-hosted fleet monitoring for package updates, Docker health and uptime.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { baseUrl, tokenConfigured } = await getInstallContext();
  // Null on /login and /setup, which render inside this layout before anyone
  // is signed in.
  const user = await getCurrentUser();

  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-screen bg-background font-sans`}
      >
        <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
          <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-4 sm:px-6">
            <Link href="/" className="flex items-center gap-2.5">
              <Logo className="h-7 w-7 text-primary" />
              <span className="text-[15px] font-semibold tracking-tight">
                Digi Fleet Watch
              </span>
            </Link>
            <span className="hidden rounded-full border border-border bg-secondary px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:inline">
              self-hosted
            </span>

            <div className="ml-auto flex items-center gap-2">
              {user ? (
                <>
                  <span className="hidden items-center gap-1.5 text-xs text-muted-foreground lg:inline-flex">
                    <span className="h-1.5 w-1.5 rounded-full bg-ok" />
                    heartbeat every 5 min
                  </span>

                  {can(user.role, "hosts:enroll") && (
                    <AddHostDialog
                      baseUrl={baseUrl}
                      tokenConfigured={tokenConfigured}
                    />
                  )}

                  <Link
                    href="/"
                    className="rounded-md border border-border bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground transition-colors hover:border-primary/40 hover:text-primary"
                  >
                    Overview
                  </Link>

                  <Link
                    href="/vulnerabilities"
                    className="rounded-md border border-border bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground transition-colors hover:border-primary/40 hover:text-primary"
                  >
                    CVEs
                  </Link>

                  <UserMenu username={user.username} role={user.role} />
                </>
              ) : null}
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
