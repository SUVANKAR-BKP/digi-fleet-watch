import Link from "next/link";
import { LogOut, Settings, ShieldCheck, User as UserIcon, Users } from "lucide-react";
import { logout } from "@/app/login/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROLE_LABELS, can, type UserRole } from "@/lib/rbac";

/**
 * Signed-in identity, role badge, and the way out.
 *
 * A server component so `logout` can be used as a form action directly, with
 * no client bundle for what is essentially a link and a button.
 */
export function UserMenu({
  username,
  role,
}: {
  username: string;
  role: UserRole;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground transition-colors hover:border-primary/40 hover:text-primary">
        <UserIcon className="h-3.5 w-3.5" />
        <span className="max-w-[10rem] truncate">{username}</span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex items-center justify-between gap-2 font-normal">
          <span className="truncate font-medium">{username}</span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            <ShieldCheck className="h-3 w-3" />
            {ROLE_LABELS[role]}
          </span>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        {can(role, "users:manage") && (
          <DropdownMenuItem asChild>
            <Link href="/users" className="cursor-pointer gap-2">
              <Users className="h-3.5 w-3.5" />
              Manage users
            </Link>
          </DropdownMenuItem>
        )}

        {can(role, "settings:manage") && (
          <DropdownMenuItem asChild>
            <Link href="/settings" className="cursor-pointer gap-2">
              <Settings className="h-3.5 w-3.5" />
              Alert settings
            </Link>
          </DropdownMenuItem>
        )}

        <DropdownMenuItem asChild>
          <Link href="/account" className="cursor-pointer gap-2">
            <UserIcon className="h-3.5 w-3.5" />
            Change password
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <form action={logout} className="w-full">
            <button
              type="submit"
              className="flex w-full cursor-pointer items-center gap-2 text-left text-down"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
