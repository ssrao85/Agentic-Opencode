import { runID } from "@opencode-ai/core/observability/shared"
import { Effect } from "effect"
import { Identifier } from "@/id/id"

const PREFIX = "x-opencode-internal-diagnostic-"
const HEADERS = {
  correlationID: `${PREFIX}correlation-id`,
  sessionID: `${PREFIX}session-id`,
  userMessageID: `${PREFIX}user-message-id`,
  assistantMessageID: `${PREFIX}assistant-message-id`,
  loopStep: `${PREFIX}loop-step`,
  providerID: `${PREFIX}provider-id`,
  modelID: `${PREFIX}model-id`,
  startedAt: `${PREFIX}started-at`,
} as const
const METADATA = {
  correlationID: "opencode.diagnostic.correlation_id",
  userMessageID: "opencode.diagnostic.user_message_id",
  assistantMessageID: "opencode.diagnostic.assistant_message_id",
  loopStep: "opencode.diagnostic.loop_step",
  providerID: "opencode.diagnostic.provider_id",
  modelID: "opencode.diagnostic.model_id",
  startedAt: "opencode.diagnostic.started_at",
} as const

const SECRET = /authorization|api[-_]?key|token|cookie|credential|password|secret|signature/i
const latest = new Map<string, Trace>()
const transport = new Map<string, number>()
const requests = new Map<string, Record<string, unknown>>()
const streams = new Map<string, Record<string, number>>()

export type Trace = {
  readonly correlationID: string
  readonly sessionID: string
  readonly userMessageID: string
  readonly assistantMessageID?: string
  readonly loopStep: number
  readonly providerID?: string
  readonly modelID?: string
  readonly startedAt: number
}

export class SilentEmptyAssistantResponse extends Error {
  override readonly name = "SilentEmptyAssistantResponse"

  constructor(readonly reason: string) {
    super(`SilentEmptyAssistantResponse: ${reason}`)
  }
}

export function enabled() {
  // This mode logs complete prompt and request bodies. Keep it opt-in even though
  // credential-shaped fields are redacted.
  return process.env.OPENCODE_SESSION_DEBUG === "1"
}

export function make(sessionID: string, userMessageID: string): Trace {
  const trace = {
    correlationID: crypto.randomUUID(),
    sessionID,
    userMessageID,
    loopStep: 0,
    startedAt: Date.now(),
  }
  latest.set(sessionID, trace)
  return trace
}

export function register(trace: Trace) {
  const current = latest.get(trace.sessionID)
  if (current?.correlationID === trace.correlationID && current.assistantMessageID && !trace.assistantMessageID)
    return trace
  latest.set(trace.sessionID, trace)
  return trace
}

export function current(sessionID: string) {
  return latest.get(sessionID)
}

export function withStep(trace: Trace, loopStep: number): Trace {
  return register({ ...trace, loopStep })
}

export function withAssistant(trace: Trace, assistantMessageID: string): Trace {
  return register({ ...trace, assistantMessageID })
}

export function withModel(trace: Trace, providerID: string, modelID: string): Trace {
  return register({ ...trace, providerID, modelID })
}

export function info(event: string, phase: string, trace: Trace, details: Record<string, unknown> = {}) {
  if (!enabled()) return Effect.void
  return Effect.logInfo(event, fields(phase, trace, details))
}

export function warning(event: string, phase: string, trace: Trace, details: Record<string, unknown> = {}) {
  if (!enabled()) return Effect.void
  return Effect.logWarning(event, fields(phase, trace, details))
}

export function error(event: string, phase: string, trace: Trace, details: Record<string, unknown> = {}) {
  if (!enabled()) return Effect.void
  return Effect.logError(event, fields(phase, trace, details))
}

export function fields(phase: string, trace: Trace, details: Record<string, unknown> = {}) {
  return {
    ...details,
    timestamp: new Date().toISOString(),
    pod_name: process.env.POD_NAME ?? process.env.HOSTNAME ?? "unknown",
    run_id: runID,
    session_id: trace.sessionID,
    user_message_id: trace.userMessageID,
    assistant_message_id: trace.assistantMessageID ?? "",
    correlation_id: trace.correlationID,
    loop_step: trace.loopStep,
    phase,
    duration_ms: Date.now() - trace.startedAt,
    provider_id: trace.providerID ?? "",
    model_id: trace.modelID ?? "",
  }
}

export function transportHeaders(trace: Trace) {
  if (!enabled()) return {}
  // These are process-internal correlation carriers. Both HTTP transport wrappers
  // remove them before delegating to the configured provider fetch.
  return {
    [HEADERS.correlationID]: trace.correlationID,
    [HEADERS.sessionID]: trace.sessionID,
    [HEADERS.userMessageID]: trace.userMessageID,
    [HEADERS.assistantMessageID]: trace.assistantMessageID ?? "",
    [HEADERS.loopStep]: trace.loopStep.toString(),
    [HEADERS.providerID]: trace.providerID ?? "",
    [HEADERS.modelID]: trace.modelID ?? "",
    [HEADERS.startedAt]: trace.startedAt.toString(),
  }
}

export function readTransportTrace(headers: Headers): Trace | undefined {
  const correlationID = headers.get(HEADERS.correlationID)
  const sessionID = headers.get(HEADERS.sessionID)
  const userMessageID = headers.get(HEADERS.userMessageID)
  if (!correlationID || !sessionID || !userMessageID) return
  const assistantMessageID = headers.get(HEADERS.assistantMessageID) || undefined
  return {
    correlationID,
    sessionID,
    userMessageID,
    assistantMessageID,
    loopStep: Number(headers.get(HEADERS.loopStep) ?? 0),
    providerID: headers.get(HEADERS.providerID) || undefined,
    modelID: headers.get(HEADERS.modelID) || undefined,
    startedAt: Number(headers.get(HEADERS.startedAt) ?? Date.now()),
  }
}

export function stripTransportHeaders(headers: Headers) {
  for (const name of Object.values(HEADERS)) headers.delete(name)
  return headers
}

export function eventMetadata(trace: Trace) {
  return {
    [METADATA.correlationID]: trace.correlationID,
    [METADATA.userMessageID]: trace.userMessageID,
    [METADATA.assistantMessageID]: trace.assistantMessageID ?? "",
    [METADATA.loopStep]: trace.loopStep,
    [METADATA.providerID]: trace.providerID ?? "",
    [METADATA.modelID]: trace.modelID ?? "",
    [METADATA.startedAt]: trace.startedAt,
  }
}

export function readEventTrace(sessionID: string, metadata: Record<string, unknown> | undefined): Trace | undefined {
  if (!metadata) return
  const correlationID = metadata[METADATA.correlationID]
  const userMessageID = metadata[METADATA.userMessageID]
  const assistantMessageID = metadata[METADATA.assistantMessageID]
  const loopStep = metadata[METADATA.loopStep]
  const providerID = metadata[METADATA.providerID]
  const modelID = metadata[METADATA.modelID]
  const startedAt = metadata[METADATA.startedAt]
  if (typeof correlationID !== "string" || typeof userMessageID !== "string") return
  return {
    correlationID,
    sessionID,
    userMessageID,
    assistantMessageID: typeof assistantMessageID === "string" && assistantMessageID ? assistantMessageID : undefined,
    loopStep: typeof loopStep === "number" ? loopStep : 0,
    providerID: typeof providerID === "string" && providerID ? providerID : undefined,
    modelID: typeof modelID === "string" && modelID ? modelID : undefined,
    startedAt: typeof startedAt === "number" ? startedAt : Date.now(),
  }
}

export function markTransportStart(trace: Trace) {
  const key = transportKey(trace)
  transport.set(key, (transport.get(key) ?? 0) + 1)
  if (transport.size > 10_000) transport.delete(transport.keys().next().value!)
}

export function transportStarts(trace: Trace) {
  return transport.get(transportKey(trace)) ?? 0
}

export function registerRequest(trace: Trace, details: Record<string, unknown>) {
  requests.set(transportKey(trace), details)
  if (requests.size > 10_000) requests.delete(requests.keys().next().value!)
}

export function requestDetails(trace: Trace) {
  return requests.get(transportKey(trace)) ?? {}
}

export function registerStreamCounters(trace: Trace, counters: Record<string, number>) {
  streams.set(transportKey(trace), counters)
  if (streams.size > 10_000) streams.delete(streams.keys().next().value!)
}

export function streamCounters(trace: Trace) {
  return streams.get(transportKey(trace)) ?? {}
}

export function redact(input: unknown, key = "", seen = new WeakSet<object>()): unknown {
  if (SECRET.test(key)) return "[REDACTED]"
  if (typeof input === "string") return redactText(input)
  if (input === null || typeof input !== "object") return input
  if (seen.has(input)) return "[Circular]"
  seen.add(input)
  if (Array.isArray(input)) return input.map((item) => redact(item, "", seen))
  if (input instanceof Headers) return redactHeaders(input)
  if (input instanceof URL) return redactURL(input)
  return Object.fromEntries(Object.entries(input).map(([name, value]) => [name, redact(value, name, seen)]))
}

export function redactHeaders(headers: Headers) {
  return Object.fromEntries(
    [...headers.entries()]
      .filter(([name]) => !name.startsWith(PREFIX))
      .map(([name, value]) => [name, SECRET.test(name) ? "[REDACTED]" : redactText(value)]),
  )
}

export function redactURL(input: RequestInfo | URL) {
  const raw = input instanceof Request ? input.url : input.toString()
  try {
    const url = new URL(raw)
    for (const name of url.searchParams.keys()) {
      if (SECRET.test(name)) url.searchParams.set(name, "[REDACTED]")
    }
    if (url.username) url.username = "[REDACTED]"
    if (url.password) url.password = "[REDACTED]"
    return url.toString()
  } catch {
    return redactText(raw)
  }
}

export function redactBody(body: string) {
  try {
    return JSON.stringify(redact(JSON.parse(body)))
  } catch {
    return redactText(body)
  }
}

export function json(input: unknown) {
  return JSON.stringify(redact(input), (_, value) => (typeof value === "bigint" ? value.toString() : value)) ?? ""
}

export async function bodyText(input: RequestInfo | URL, body: BodyInit | null | undefined) {
  if (typeof body === "string") return body
  if (body instanceof URLSearchParams) return body.toString()
  if (body instanceof Blob) return body.text()
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body)
  if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body)
  if (input instanceof Request) return input.clone().text()
  return body ? `[${body.constructor.name}]` : ""
}

export function sha256(body: string) {
  return new Bun.CryptoHasher("sha256").update(body).digest("hex")
}

export function bodyLength(body: string) {
  return new TextEncoder().encode(body).byteLength
}

export function idTimestamp(id: string) {
  if (!/^[^_]+_[0-9a-fA-F]{12}/.test(id)) return
  return Identifier.timestamp(id)
}

function transportKey(trace: Trace) {
  return `${trace.correlationID}:${trace.assistantMessageID ?? ""}`
}

function redactText(value: string) {
  return value
    .replace(/(bearer\s+)[^\s",]+/gi, "$1[REDACTED]")
    .replace(/((?:api[-_]?key|token|cookie|credential|password|secret)\s*[=:]\s*)[^\s,;&]+/gi, "$1[REDACTED]")
}

export * as SessionDiagnostic from "./diagnostic"
