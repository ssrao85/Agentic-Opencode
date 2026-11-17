import fs from "node:fs"
import { Schema } from "effect"

// Deployed apps are user-launched loopback servers exposed under /apps/<name>/.
// The `apps` CLI in the container image owns them: it launches, stops, restores and
// supervises the processes and keeps the JSON registry on the persistent volume.
// opencode only reads that registry (re-read per call, so CLI changes show up at
// once) and runs the CLI for actions, so process handling lives in one place.

export const Framework = Schema.Literals(["fastapi", "flask", "streamlit", "vite", "next", "node", "static"])
export type Framework = Schema.Schema.Type<typeof Framework>

export const Info = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  port: Schema.Finite,
  status: Schema.Literals(["running", "stopped"]),
  framework: Schema.optional(Framework),
  deployedAt: Schema.optional(Schema.Finite),
  autoRestart: Schema.Boolean,
  startable: Schema.Boolean,
}).annotate({ identifier: "DeployedApp" })
export type Info = Schema.Schema.Type<typeof Info>

export type Entry = {
  port: number
  pid?: number
  cmd?: string[]
  framework?: string
  deployedAt?: number
  autoRestart?: boolean
}

export function registryPath() {
  return process.env["OPENCODE_APPS_REGISTRY"] ?? "/all-workspaces/apps.json"
}

export function cli() {
  return process.env["OPENCODE_APPS_CLI"] ?? "apps"
}

export function list(): Info[] {
  return Object.entries(read())
    .filter(([, entry]) => entry && typeof entry.port === "number")
    .map(([name, entry]) => toInfo(name, entry))
    .toSorted((a, b) => (b.deployedAt ?? 0) - (a.deployedAt ?? 0) || a.name.localeCompare(b.name))
}

export function get(name: string) {
  const entry = read()[name]
  if (!entry || typeof entry.port !== "number") return undefined
  return toInfo(name, entry)
}

export function inferFramework(entry: Pick<Entry, "framework" | "cmd">): Framework | undefined {
  const declared = Schema.decodeUnknownOption(Framework)(entry.framework?.toLowerCase())
  if (declared._tag === "Some") return declared.value
  const cmd = (entry.cmd ?? []).join(" ").toLowerCase()
  if (cmd.includes("streamlit")) return "streamlit"
  if (/uvicorn|fastapi|hypercorn/.test(cmd)) return "fastapi"
  if (/gunicorn|flask/.test(cmd)) return "flask"
  if (cmd.includes("vite")) return "vite"
  if (/\bnext\b/.test(cmd)) return "next"
  if (cmd.includes("http.server")) return "static"
  if (/\b(npm|node|bun|pnpm|yarn)\b/.test(cmd)) return "node"
  return undefined
}

function read(): Record<string, Entry> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(registryPath(), "utf8"))
    return parsed && typeof parsed === "object" ? (parsed as Record<string, Entry>) : {}
  } catch {
    return {}
  }
}

function toInfo(name: string, entry: Entry): Info {
  const framework = inferFramework(entry)
  return {
    name,
    path: `/apps/${name}/`,
    port: entry.port,
    status: alive(entry.pid) ? "running" : "stopped",
    // Omit unknown values instead of sending undefined, which the API encodes as null.
    ...(framework ? { framework } : {}),
    ...(typeof entry.deployedAt === "number" ? { deployedAt: entry.deployedAt } : {}),
    autoRestart: entry.autoRestart === true,
    startable: !!entry.cmd?.length,
  }
}

function alive(pid: number | undefined) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

export * as DeployedApp from "."
