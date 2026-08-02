import { describe, expect, test } from "bun:test"
import { SessionDiagnostic } from "@/session/diagnostic"
import { Identifier } from "@/id/id"

describe("session diagnostics", () => {
  test("redacts credentials without removing prompt content", () => {
    expect(
      SessionDiagnostic.redact({
        apiKey: "secret-key",
        nested: { access_token: "secret-token", content: "keep the full prompt" },
        headers: new Headers({ Authorization: "Bearer secret", "x-request": "visible" }),
      }),
    ).toEqual({
      apiKey: "[REDACTED]",
      nested: { access_token: "[REDACTED]", content: "keep the full prompt" },
      headers: { authorization: "[REDACTED]", "x-request": "visible" },
    })
  })

  test("redacts secret query parameters", () => {
    expect(SessionDiagnostic.redactURL("https://llm.example/v1/chat?api_key=secret&region=local")).toBe(
      "https://llm.example/v1/chat?api_key=%5BREDACTED%5D&region=local",
    )
  })

  test("round trips and strips internal transport correlation headers", () => {
    const trace = SessionDiagnostic.withModel(
      SessionDiagnostic.withAssistant(SessionDiagnostic.make("session-1", "user-1"), "assistant-1"),
      "provider-1",
      "model-1",
    )
    const previous = process.env.OPENCODE_SESSION_DEBUG
    process.env.OPENCODE_SESSION_DEBUG = "1"
    const headers = new Headers({ Authorization: "Bearer secret" })
    for (const [name, value] of Object.entries(SessionDiagnostic.transportHeaders(trace))) {
      if (value !== undefined) headers.set(name, value)
    }
    const decoded = SessionDiagnostic.readTransportTrace(headers)
    const stripped = SessionDiagnostic.stripTransportHeaders(headers)
    if (previous === undefined) delete process.env.OPENCODE_SESSION_DEBUG
    else process.env.OPENCODE_SESSION_DEBUG = previous

    expect(decoded).toEqual(trace)
    expect([...stripped.keys()]).toEqual(["authorization"])
    expect(SessionDiagnostic.redactHeaders(stripped)).toEqual({ authorization: "[REDACTED]" })
  })

  test("round trips correlation through event metadata for another pod", () => {
    const trace = SessionDiagnostic.withModel(
      SessionDiagnostic.withAssistant(SessionDiagnostic.make("session-2", "user-2"), "assistant-2"),
      "provider-2",
      "model-2",
    )

    expect(SessionDiagnostic.readEventTrace(trace.sessionID, SessionDiagnostic.eventMetadata(trace))).toEqual(trace)
  })

  test("reads generated message time without rejecting caller-provided message IDs", () => {
    expect(SessionDiagnostic.idTimestamp(Identifier.create("msg", "ascending", 1_234))).toBe(1_234)
    expect(SessionDiagnostic.idTimestamp("msg_user-supplied")).toBeUndefined()
  })
})
