"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Box, Disc3, History, LayoutDashboard, Plus, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { InstallButton } from "./pwa";
import { AppLogo } from "./logo";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/spools/", label: "Spools", icon: Disc3 },
  { href: "/prints/new/", label: "Log print", icon: Plus, primary: true },
  { href: "/prints/", label: "Prints", icon: Box },
  { href: "/history/", label: "History", icon: History },
  { href: "/settings/", label: "Settings", icon: Settings, desktopOnly: true },
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
      <aside className="bg-card border-border/60 sticky top-4 m-4 mr-0 hidden h-[calc(100dvh-2rem)] w-60 shrink-0 flex-col gap-1 rounded-3xl border p-4 shadow-[0_8px_24px_-12px_rgb(15_23_42/0.12)] md:flex">
        <Link
          href="/"
          className="font-display mb-6 flex items-center gap-2 px-2 py-1 text-lg font-semibold tracking-tight"
        >
          <AppLogo className="size-8" /> Spooliyoo
        </Link>
        {NAV.map(({ href, label, icon: Icon, ...rest }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(path, href) ? "page" : undefined}
            className={cn(
              "hover:bg-muted flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium",
              isActive(path, href) && "bg-primary-soft text-primary",
              "primary" in rest && "bg-accent text-accent-foreground hover:bg-accent/90 font-medium",
            )}
          >
            <Icon className="size-4" /> {label}
          </Link>
        ))}
        <InstallButton className="mt-auto" />
      </aside>

      {/* Mobile top bar */}
      <header className="bg-card/95 border-border/60 sticky top-2 z-30 mx-3 mt-2 flex h-14 items-center justify-between rounded-full border px-4 shadow-[0_8px_24px_-12px_rgb(15_23_42/0.15)] backdrop-blur md:hidden">
        <Link
          href="/"
          className="font-display flex items-center gap-2 text-base font-semibold tracking-tight"
        >
          <AppLogo className="size-7" /> Spooliyoo
        </Link>
        <div className="flex items-center gap-1">
          <InstallButton size="sm" />
          <Link
            href="/settings/"
            aria-label="Settings"
            aria-current={isActive(path, "/settings/") ? "page" : undefined}
            className={cn(
              "hover:bg-muted flex size-9 items-center justify-center rounded-full",
              isActive(path, "/settings/") ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Settings className="size-5" />
          </Link>
        </div>
      </header>

      <main
        id="main"
        className="mx-auto w-full max-w-4xl flex-1 px-4 pt-4 pb-[calc(10rem+env(safe-area-inset-bottom))] md:px-8 md:pt-8 md:pb-28"
      >
        {children}
      </main>

      {/* Mobile bottom navigation */}
      <nav
        aria-label="Main"
        className="bg-card/95 fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t pb-[calc(0.5rem+env(safe-area-inset-bottom))] backdrop-blur md:hidden"
      >
        {NAV.filter((n) => !("desktopOnly" in n)).map(({ href, label, icon: Icon, ...rest }) => {
          const active = isActive(path, href);
          if ("primary" in rest)
            return (
              <Link
                key={href}
                href={href}
                className="flex flex-col items-center justify-center gap-0.5 py-1.5"
              >
                <span className="bg-accent text-accent-foreground -mt-5 flex size-12 items-center justify-center rounded-full shadow-lg">
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
