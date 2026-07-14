import { describe, expect, test } from "bun:test"
import {
  formatStorageBytes,
  formatStoragePercent,
  formatStorageUpdatedAt,
  storageStateColor,
  storageStateLegacyColor,
} from "./workspace-storage-utils"

describe("workspace storage indicator", () => {
  test("formats byte totals for display", () => {
    expect(formatStorageBytes(0, "en")).toBe("0 B")
    expect(formatStorageBytes(1536, "en")).toBe("1.5 KB")
    expect(formatStorageBytes(1024 ** 3, "en")).toBe("1 GB")
    expect(formatStorageBytes(undefined, "en")).toBe("--")
  })

  test("maps storage states to green, orange, and red", () => {
    expect(storageStateColor("healthy")).toBe("var(--v2-green-700)")
    expect(storageStateColor("warning")).toBe("var(--v2-orange-700)")
    expect(storageStateColor("critical")).toBe("var(--v2-red-700)")
    expect(storageStateLegacyColor("healthy")).toBe("var(--icon-success-base)")
    expect(storageStateLegacyColor("warning")).toBe("var(--icon-warning-base)")
    expect(storageStateLegacyColor("critical")).toBe("var(--icon-critical-base)")
  })

  test("formats the updated time", () => {
    expect(formatStorageUpdatedAt(0, "en")).toBe("--")
    expect(formatStorageUpdatedAt(new Date(2026, 0, 2, 3, 4).getTime(), "en")).toContain("3:04")
  })

  test("formats percentage usage", () => {
    expect(formatStoragePercent(42.4, "en")).toBe("42%")
    expect(formatStoragePercent(undefined, "en")).toBe("--")
  })
})
