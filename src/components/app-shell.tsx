"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { History, LayoutDashboard, Plus, Settings, Disc3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { InstallButton } from "./pwa";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/spools/", label: "Spools", icon: Disc3 },
  { href: "/prints/new/", label: "Log print", icon: Plus, primary: true },
  { href: "/prints/", label: "History", icon: History },
  { href: "/settings/", label: "Settings", icon: Settings },
] as const;

function isActive(path: string, href: string) {
  const p = path.endsWith("/") ? path : path + "/";
  if (href === "/") return p === "/";
  if (href === "/prints/") return p.startsWith("/prints/") && !p.startsWith("/prints/new/");
  return p.startsWith(href);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname() ?? "/";
  return (
    <div className="min-h-dvh md:flex">
      <a
        href="#main"
        className="focus:bg-card sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <aside className="bg-card sticky top-0 hidden h-dvh w-56 shrink-0 flex-col gap-1 border-r p-3 md:flex">
        <Link href="/" className="mb-4 flex items-center gap-2 px-2 py-1 font-semibold">
          <Disc3 className="text-primary size-6" /> Filament Tracker
        </Link>
        {NAV.map(({ href, label, icon: Icon, ...rest }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(path, href) ? "page" : undefined}
            className={cn(
              "hover:bg-muted flex items-center gap-3 rounded-lg px-3 py-2 text-sm",
              isActive(path, href) && "bg-muted font-medium",
              "primary" in rest && "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
          >
            <Icon className="size-4" /> {label}
          </Link>
        ))}
        <InstallButton className="mt-auto" />
      </aside>

      {/* Mobile top bar */}
      <header className="bg-card/95 sticky top-0 z-30 flex h-12 items-center justify-between border-b px-4 backdrop-blur md:hidden">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold">
          <Disc3 className="text-primary size-5" /> Filament Tracker
        </Link>
        <InstallButton size="sm" />
      </header>

      <main id="main" className="mx-auto w-full max-w-4xl flex-1 px-4 pt-4 pb-28 md:px-8 md:pt-8 md:pb-10">
        {children}
      </main>

      {/* Mobile bottom navigation */}
      <nav
        aria-label="Main"
        className="bg-card/95 fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {NAV.map(({ href, label, icon: Icon, ...rest }) => {
          const active = isActive(path, href);
          if ("primary" in rest)
            return (
              <Link
                key={href}
                href={href}
                className="flex flex-col items-center justify-center gap-0.5 py-1.5"
              >
                <span className="bg-primary text-primary-foreground -mt-5 flex size-12 items-center justify-center rounded-full shadow-lg">
                  <Icon className="size-6" />
                </span>
                <span className="text-[11px]">{label}</span>
              </Link>
            );
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 py-2 text-[11px]",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className="size-5" />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
