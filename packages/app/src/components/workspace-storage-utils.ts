export type StorageState = "healthy" | "warning" | "critical"

export const FALLBACK_REFRESH_INTERVAL_MS = 60_000

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const

export function storageStateColor(state: StorageState | undefined) {
  if (state === "critical") return "var(--v2-red-700)"
  if (state === "warning") return "var(--v2-orange-700)"
  return "var(--v2-green-700)"
}

export function storageStateLegacyColor(state: StorageState | undefined) {
  if (state === "critical") return "var(--icon-critical-base)"
  if (state === "warning") return "var(--icon-warning-base)"
  return "var(--icon-success-base)"
}

export function formatStorageBytes(value: number | undefined, locale = "en") {
  if (value === undefined || !Number.isFinite(value) || value < 0) return "--"
  const unit = Math.min(Math.floor(Math.log(Math.max(value, 1)) / Math.log(1024)), BYTE_UNITS.length - 1)
  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value / 1024 ** unit)} ${BYTE_UNITS[unit]}`
}

export function formatStorageUpdatedAt(value: number | undefined, locale = "en") {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return "--"
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(new Date(value))
}

export function formatStoragePercent(value: number | string | undefined, locale = "en") {
  const number = typeof value === "number" && Number.isFinite(value) ? value : undefined
  if (number === undefined) return "--"
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(number)}%`
}
