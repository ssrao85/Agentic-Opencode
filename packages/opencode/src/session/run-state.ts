import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Runner } from "@/effect/runner"
import { BackgroundJob } from "@/background/job"
import { Cause, Effect, Exit, Latch, Layer, Scope, Context } from "effect"
import { Session } from "./session"
import { SessionID } from "./schema"
import { SessionStatus } from "./status"
import { SessionDiagnostic } from "./diagnostic"

export interface Interface {
  readonly assertNotBusy: (sessionID: SessionID) => Effect.Effect<void, Session.BusyError>
  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
  readonly ensureRunning: (
    sessionID: SessionID,
    diagnostic: SessionDiagnostic.Trace,
    onInterrupt: Effect.Effect<SessionV1.WithParts>,
    work: Effect.Effect<SessionV1.WithParts>,
  ) => Effect.Effect<SessionV1.WithParts>
  readonly startShell: (
    sessionID: SessionID,
    onInterrupt: Effect.Effect<SessionV1.WithParts>,
    work: Effect.Effect<SessionV1.WithParts>,
    ready?: Latch.Latch,
  ) => Effect.Effect<SessionV1.WithParts, Session.BusyError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRunState") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const background = yield* BackgroundJob.Service
    const status = yield* SessionStatus.Service

    const state = yield* InstanceState.make(
      Effect.fn("SessionRunState.state")(function* () {
        const scope = yield* Scope.Scope
        const runners = new Map<SessionID, Runner.Runner<SessionV1.WithParts>>()
        yield* Effect.addFinalizer(
          Effect.fnUntraced(function* () {
            yield* Effect.forEach(runners.values(), (runner) => runner.cancel, {
              concurrency: "unbounded",
              discard: true,
            })
            runners.clear()
          }),
        )
        return { runners, scope }
      }),
    )

    const runner = Effect.fn("SessionRunState.runner")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<SessionV1.WithParts>,
    ) {
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(sessionID)
      if (existing) return existing
      const next = Runner.make<SessionV1.WithParts>(data.scope, {
        onIdle: Effect.gen(function* () {
          data.runners.delete(sessionID)
          const diagnostic = SessionDiagnostic.current(sessionID)
          if (diagnostic) {
            yield* SessionDiagnostic.info("session run state removed", "run_state.removed", diagnostic, {
              runner_count: data.runners.size,
            })
          }
          yield* status.set(sessionID, { type: "idle" })
        }),
        onBusy: status.set(sessionID, { type: "busy" }),
        onInterrupt,
      })
      data.runners.set(sessionID, next)
      return next
    })

    const assertNotBusy = Effect.fn("SessionRunState.assertNotBusy")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(sessionID)
      if (existing?.busy) yield* busyError(sessionID)
    })

    const cancel = Effect.fn("SessionRunState.cancel")(function* (sessionID: SessionID) {
      yield* cancelBackgroundJobs(background, sessionID)
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(sessionID)
      if (!existing) {
        yield* status.set(sessionID, { type: "idle" })
        return
      }
      yield* existing.cancel
    })

    const ensureRunning = Effect.fn("SessionRunState.ensureRunning")(function* (
      sessionID: SessionID,
      diagnostic: SessionDiagnostic.Trace,
      onInterrupt: Effect.Effect<SessionV1.WithParts>,
      work: Effect.Effect<SessionV1.WithParts>,
    ) {
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(sessionID)
      const selected = yield* runner(sessionID, onInterrupt)
      const current = selected.state
      const run = current._tag === "Running" || current._tag === "ShellThenRun" ? current.run : undefined
      const fiber = run && "fiber" in run ? run.fiber : undefined
      yield* SessionDiagnostic.info("run-state checked", "run_state.checked", diagnostic, {
        already_marked_running: selected.busy,
        runner_map_entry_existed: !!existing,
        runner_state: current._tag,
        runner_id: run?.id ?? "",
        fiber_id: fiber?.id ?? "",
        fiber_status: fiber ? (fiber.pollUnsafe() ? "completed" : "running") : "none",
        cancelled_or_interrupted: false,
      })
      const instrumented = Effect.gen(function* () {
        const startedAt = Date.now()
        const fiberID = yield* Effect.fiberId
        yield* SessionDiagnostic.info("session fiber started", "run_state.fiber.started", diagnostic, {
          fiber_id: fiberID,
          fiber_started_at: new Date(startedAt).toISOString(),
          fiber_status: "running",
          cancelled_or_interrupted: false,
        })
        return yield* work.pipe(
          Effect.onExit((exit) =>
            SessionDiagnostic.info("session fiber completed", "run_state.fiber.completed", diagnostic, {
              fiber_id: fiberID,
              fiber_started_at: new Date(startedAt).toISOString(),
              fiber_completed_at: new Date().toISOString(),
              fiber_duration_ms: Date.now() - startedAt,
              fiber_status: Exit.isSuccess(exit) ? "completed" : "failed",
              cancelled_or_interrupted: Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause),
              exit: exit._tag,
            }),
          ),
        )
      })

      const result = yield* selected
        .ensureRunning(instrumented, (selection) =>
          SessionDiagnostic.info("new or existing session fiber selected", "run_state.fiber.selected", diagnostic, {
            new_runner_created: !existing,
            new_fiber_created: selection.type === "created",
            existing_fiber_reused: selection.type === "reused",
            queued_after_shell: selection.type === "queued-after-shell",
            selection: selection.type,
            runner_id: selection.runnerID,
            fiber_id: selection.fiberID ?? "",
            fiber_status: selection.fiberStatus,
          }),
        )
        .pipe(
          Effect.onInterrupt(() =>
            SessionDiagnostic.warning("ensureRunning interrupted", "run_state.ensure.interrupted", diagnostic, {
              cancelled_or_interrupted: true,
            }),
          ),
        )
      yield* SessionDiagnostic.info("ensureRunning completed", "run_state.ensure.completed", diagnostic, {
        stored_assistant_result_id: result.info.id,
        stored_assistant_parent_id: result.info.role === "assistant" ? result.info.parentID : "",
        result_role: result.info.role,
        result_matches_user_prompt:
          result.info.role === "assistant" ? result.info.parentID === diagnostic.userMessageID : false,
        cancelled_or_interrupted: false,
      })
      return result
    })

    const startShell = Effect.fn("SessionRunState.startShell")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<SessionV1.WithParts>,
      work: Effect.Effect<SessionV1.WithParts>,
      ready?: Latch.Latch,
    ) {
      return yield* (yield* runner(sessionID, onInterrupt))
        .startShell(work, ready)
        .pipe(Effect.catchTag("RunnerBusy", () => Effect.fail(busyError(sessionID))))
    })

    return Service.of({ assertNotBusy, cancel, ensureRunning, startShell })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(BackgroundJob.defaultLayer),
  Layer.provide(SessionStatus.defaultLayer),
)

const cancelBackgroundJobs = Effect.fn("SessionRunState.cancelBackgroundJobs")(function* (
  background: BackgroundJob.Interface,
  sessionID: SessionID,
) {
  const jobs = yield* background.list()
  const pending = new Set<string>([sessionID])
  const cancelled = new Set<string>()
  const matches = (job: BackgroundJob.Info) => {
    if (job.status !== "running") return false
    if (cancelled.has(job.id)) return false
    if (pending.has(job.id)) return true
    if (typeof job.metadata?.sessionId === "string" && pending.has(job.metadata.sessionId)) return true
    return typeof job.metadata?.parentSessionId === "string" && pending.has(job.metadata.parentSessionId)
  }
  let batch = jobs.filter(matches)
  while (batch.length > 0) {
    yield* Effect.forEach(
      batch,
      (job) =>
        background.cancel(job.id).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              cancelled.add(job.id)
              pending.add(job.id)
              if (typeof job.metadata?.sessionId === "string") pending.add(job.metadata.sessionId)
            }),
          ),
        ),
      { concurrency: "unbounded", discard: true },
    )
    batch = jobs.filter(matches)
  }
})

function busyError(sessionID: SessionID) {
  return new Session.BusyError({ sessionID })
}

export const node = LayerNode.make(layer, [BackgroundJob.node, SessionStatus.node])

export * as SessionRunState from "./run-state"
