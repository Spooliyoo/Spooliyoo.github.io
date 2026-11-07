import { describe, expect, it } from "vitest";
import { isStorageFullError, storageLevel } from "@/lib/storage-errors";
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

describe("storage level", () => {
  const GB = 1024 ** 3;
  const MB = 1024 ** 2;
  it("is ok with plenty of room", () => expect(storageLevel(1 * GB, 10 * GB)).toBe("ok"));
  it("warns at 80% used", () => expect(storageLevel(8 * GB, 10 * GB)).toBe("low"));
  it("warns when under 200 MB is left", () => expect(storageLevel(400 * MB, 550 * MB)).toBe("low"));
  it("is critical at 95% or under 25 MB left", () => {
    expect(storageLevel(9.6 * GB, 10 * GB)).toBe("critical");
    expect(storageLevel(100 * MB, 120 * MB)).toBe("critical");
  });
  it("stays quiet when the browser gives no estimate", () =>
    expect(storageLevel(undefined, undefined)).toBe("ok"));
});
