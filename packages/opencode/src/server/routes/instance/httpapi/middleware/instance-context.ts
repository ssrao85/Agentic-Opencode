import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { InstanceStore } from "@/project/instance-store"
import { Project } from "@/project/project"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect, Layer } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { WorkspaceRouteContext } from "./workspace-routing"

export class InstanceContextMiddleware extends HttpApiMiddleware.Service<
  InstanceContextMiddleware,
  {
    requires: WorkspaceRouteContext
  }
>()("@opencode/ExperimentalHttpApiInstanceContext") {}

export class ProjectContextMiddleware extends HttpApiMiddleware.Service<
  ProjectContextMiddleware,
  {
    requires: WorkspaceRouteContext
  }
>()("@opencode/ExperimentalHttpApiProjectContext") {}

function decode(input: string): string {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

function provideInstanceContext<E>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E>,
  store: InstanceStore.Interface,
): Effect.Effect<HttpServerResponse.HttpServerResponse, E, WorkspaceRouteContext> {
  return Effect.gen(function* () {
    const route = yield* WorkspaceRouteContext
    const ctx = yield* store.load({ directory: decode(route.directory) })
    return yield* effect.pipe(
      Effect.provideService(InstanceRef, ctx),
      Effect.provideService(WorkspaceRef, route.workspaceID),
    )
  })
}

export const instanceContextLayer = Layer.effect(
  InstanceContextMiddleware,
  Effect.gen(function* () {
    const store = yield* InstanceStore.Service
    return InstanceContextMiddleware.of((effect) => provideInstanceContext(effect, store))
  }),
)

// Metadata needs project identity and routing context without acquiring an
// InstanceStore entry or starting its plugins and location services.
export const projectContextLayer = Layer.effect(
  ProjectContextMiddleware,
  Effect.gen(function* () {
    const project = yield* Project.Service
    return ProjectContextMiddleware.of((effect) =>
      Effect.gen(function* () {
        const route = yield* WorkspaceRouteContext
        const directory = FSUtil.resolve(decode(route.directory))
        const resolved = yield* project.fromDirectory(directory)
        return yield* effect.pipe(
          Effect.provideService(InstanceRef, { directory, worktree: resolved.sandbox, project: resolved.project }),
          Effect.provideService(WorkspaceRef, route.workspaceID),
        )
      }),
    )
  }),
)
