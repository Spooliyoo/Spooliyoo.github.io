import { describe, expect, it } from "vitest";
import { isStorageFullError } from "@/lib/storage-errors";
import { errorMessage } from "@/lib/utils";

describe("storage-full detection", () => {
  it("recognises the browser's quota errors, however wrapped", () => {
    expect(isStorageFullError(new DOMException("", "QuotaExceededError"))).toBe(true);
    expect(isStorageFullError({ errno: 28 })).toBe(true); // ENOSPC from the database file system
    expect(
      isStorageFullError(new Error("sync failed", { cause: new DOMException("x", "QuotaExceededError") })),
    ).toBe(true);
    expect(isStorageFullError(new Error("No space left on device"))).toBe(true);
  });
  it("ignores other errors", () => {
    expect(isStorageFullError(new Error("Spool not found"))).toBe(false);
    expect(isStorageFullError(null)).toBe(false);
  });
  it("gives a plain-language message", () => {
    expect(errorMessage(new DOMException("", "QuotaExceededError"))).toMatch(
      /out of storage space, so nothing was saved/,
    );
    expect(errorMessage(new Error("Spool not found"))).toBe("Spool not found");
  });
});
