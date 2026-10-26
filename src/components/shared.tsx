"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ImageOff, AlertTriangle, ShieldCheck } from "lucide-react";
import { useApp, useSettings } from "./providers";
import { Badge, Button, ProgressBar, Swatch } from "./ui";
import type { SpoolWithStats } from "@/lib/db/repo";
import { formatGrams } from "@/lib/calc";
import { cn } from "@/lib/utils";

export function spoolTone(s: Pick<SpoolWithStats, "remainingG">, lowStockG: number) {
  if (s.remainingG <= 0) return "empty" as const;
  if (s.remainingG < lowStockG) return "low" as const;
  return "ok" as const;
}

export function StockBadge({ spool }: { spool: SpoolWithStats }) {
  const st = useSettings();
  if (spool.status === "archived") return <Badge>Archived</Badge>;
  const tone = spoolTone(spool, st?.lowStockG ?? 100);
  if (spool.remainingG < 0)
    return (
      <Badge variant="danger">
        <AlertTriangle className="size-3" /> Negative — re-weigh
      </Badge>
    );
  if (tone === "empty") return <Badge variant="danger">Empty</Badge>;
  if (tone === "low") return <Badge variant="warning">Low stock</Badge>;
  return null;
}

export function SpoolRow({ spool, className }: { spool: SpoolWithStats; className?: string }) {
  const st = useSettings();
  const tone = spoolTone(spool, st?.lowStockG ?? 100);
  return (
    <Link
      href={`/spools/view/?id=${spool.id}`}
      className={cn("hover:bg-muted/60 focus-visible:bg-muted/60 flex flex-col gap-2 px-4 py-3", className)}
    >
      <div className="flex items-center gap-3">
        <Swatch hex={spool.colourHex} className="size-8" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate font-medium">{spool.name}</span>
            <StockBadge spool={spool} />
          </div>
          <div className="text-muted-foreground truncate text-xs">
            <span className="font-mono">{spool.spoolCode}</span> · {spool.material}
            {spool.brand && ` · ${spool.brand}`}
            {spool.colourName && ` · ${spool.colourName}`}
          </div>
        </div>
        <div className="text-right">
          <div className={cn("tabular font-semibold", spool.remainingG < 0 && "text-danger")}>
            {formatGrams(spool.remainingG)}
          </div>
          <div className="tabular text-muted-foreground text-xs">{Math.round(spool.pctLeft)}% left</div>
        </div>
      </div>
      <ProgressBar value={spool.pctLeft} tone={tone} />
    </Link>
  );
}

export function BackButton({ fallback = "/" }: { fallback?: string }) {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Back"
      onClick={() => (window.history.length > 1 ? router.back() : router.push(fallback))}
    >
      <ArrowLeft className="!size-5" />
    </Button>
  );
}

/** Renders a stored photo blob via an object URL. */
export function PhotoImg({ id, alt, className }: { id: string; alt: string; className?: string }) {
  const { photos } = useApp();
  const [url, setUrl] = React.useState<string | null>(null);
  const [missing, setMissing] = React.useState(false);
  React.useEffect(() => {
    let u: string | null = null;
    let alive = true;
    photos.get(id).then((b) => {
      if (!alive) return;
      if (!b) return setMissing(true);
      u = URL.createObjectURL(b);
      setUrl(u);
    });
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [id, photos]);
  if (missing)
    return (
      <div className={cn("bg-muted text-muted-foreground flex items-center justify-center", className)}>
        <ImageOff className="size-5" />
      </div>
    );
  if (!url) return <div className={cn("bg-muted animate-pulse", className)} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} className={cn("object-cover", className)} />;
}

export function LocalDataNotice({ className }: { className?: string }) {
  return (
    <p className={cn("text-muted-foreground flex items-start gap-2 text-xs", className)}>
      <ShieldCheck className="mt-px size-4 shrink-0" />
      Your data is stored only on this device, in this browser. Export a backup regularly to keep it safe.
    </p>
  );
}

export function useSearchParam(name: string): string | null {
  return useSearchParams().get(name);
}

/** Pages that read query params must render inside Suspense under static export. */
export function withSuspense<P extends object>(C: React.ComponentType<P>) {
  const Wrapped = (props: P) => (
    <React.Suspense fallback={null}>
      <C {...props} />
    </React.Suspense>
  );
  Wrapped.displayName = `withSuspense(${C.displayName ?? C.name})`;
  return Wrapped;
}
