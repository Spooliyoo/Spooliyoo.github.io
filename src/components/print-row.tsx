"use client";

import Link from "next/link";
import { Box } from "lucide-react";
import type { PrintListItem } from "@/lib/db/repo";
import { useMoney } from "./providers";
import { PhotoImg } from "./shared";
import { Badge, Swatch } from "./ui";
import { formatDuration, formatGrams } from "@/lib/calc";
import { formatDate } from "@/lib/utils";

export function PrintRow({ print: p }: { print: PrintListItem }) {
  const money = useMoney();
  return (
    <Link href={`/prints/view/?id=${p.id}`} className="hover:bg-muted/60 flex items-center gap-3 px-4 py-3">
      {p.thumbId ? (
        <PhotoImg id={p.thumbId} alt="" className="size-12 shrink-0 rounded-lg" />
      ) : (
        <div className="bg-muted text-muted-foreground flex size-12 shrink-0 items-center justify-center rounded-lg">
          <Box className="size-5" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{p.modelName}</span>
          {p.status === "failed" && <Badge variant="danger">Failed</Badge>}
        </div>
        <div className="text-muted-foreground flex items-center gap-1.5 truncate text-xs">
          <span className="flex -space-x-1">
            {p.colours.slice(0, 4).map((c, i) => (
              <Swatch key={i} hex={c} className="size-3" />
            ))}
          </span>
          {formatDate(p.printedAt)} · {formatGrams(p.totalG)} · {formatDuration(p.printMinutes)}
        </div>
      </div>
      <div className="text-right text-sm">
        <div className="tabular font-medium">{money(p.sellingPrice)}</div>
        <div className="tabular text-muted-foreground text-xs">cost {money(p.totalCost)}</div>
      </div>
    </Link>
  );
}
