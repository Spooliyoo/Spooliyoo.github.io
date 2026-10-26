"use client";

import imageCompression from "browser-image-compression";
import type { NewPhoto } from "./db/repo";

/** Shrinks a photo to ~1280 px / ~150 KB (NFR-7). Prefers WebP, falls back to JPEG (older Safari). */
export async function compressPhoto(file: File): Promise<NewPhoto> {
  const supportsWebp = document.createElement("canvas").toDataURL("image/webp").startsWith("data:image/webp");
  const fileType = supportsWebp ? "image/webp" : "image/jpeg";
  const out = await imageCompression(file, {
    maxWidthOrHeight: 1280,
    maxSizeMB: 0.15,
    initialQuality: 0.8,
    fileType,
    useWebWorker: false, // the library's worker loads from a CDN; keep everything local/offline
  });
  const bmp = await createImageBitmap(out);
  const photo = { blob: out, mimeType: out.type || fileType, width: bmp.width, height: bmp.height };
  bmp.close();
  return photo;
}
