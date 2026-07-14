import * as InstanceState from "@/effect/instance-state"
import { Project } from "@/project/project"
import { Session } from "@/session/session"
import { ProjectV2 } from "@opencode-ai/core/project"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { notFound, ProjectNotFoundError } from "../errors"
import { markInstanceForReload } from "../lifecycle"

export const projectHandlers = HttpApiBuilder.group(InstanceHttpApi, "project", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* Project.Service
    const project = yield* ProjectV2.Service
    const session = yield* Session.Service

    const list = Effect.fn("ProjectHttpApi.list")(function* () {
      return yield* svc.list()
    })

    const create = Effect.fn("ProjectHttpApi.create")(function* () {
      return yield* svc.createManaged()
    })

    const managed = Effect.fn("ProjectHttpApi.managed")(function* () {
      return yield* svc.listManaged()
    })

    const managedRoot = Effect.fn("ProjectHttpApi.managedRoot")(function* () {
      return yield* svc.managedRoot()
    })

    const managedStorage = Effect.fn("ProjectHttpApi.managedStorage")(function* () {
      return yield* svc.managedStorage()
    })

    const deleteManaged = Effect.fn("ProjectHttpApi.deleteManaged")(function* (ctx: {
      params: { workspaceID: string }
    }) {
      const workspace = yield* svc.getManaged(ctx.params.workspaceID)
      if (!workspace) return yield* Effect.fail(notFound(`Managed workspace not found: ${ctx.params.workspaceID}`))

      const sessions = yield* session.listGlobal({
        directory: workspace.directory,
        archived: true,
        roots: true,
        limit: Number.MAX_SAFE_INTEGER,
      })
      yield* Effect.forEach(sessions, (item) => session.remove(item.id).pipe(Effect.catch(() => Effect.void)), {
        concurrency: 1,
        discard: true,
      })

      return yield* svc.deleteManaged(ctx.params.workspaceID).pipe(
        Effect.catchTag("Project.ManagedWorkspaceNotFoundError", (error) =>
          Effect.fail(notFound(`Managed workspace not found: ${error.workspaceID}`)),
        ),
        Effect.catchTag("Project.ManagedWorkspaceUnsafePathError", () => Effect.fail(new HttpApiError.BadRequest({}))),
      )
    })

    const current = Effect.fn("ProjectHttpApi.current")(function* () {
      return (yield* InstanceState.context).project
    })

    const initGit = Effect.fn("ProjectHttpApi.initGit")(function* () {
      const ctx = yield* InstanceState.context
      const next = yield* svc.initGit({ directory: ctx.directory, project: ctx.project })
      if (next.id === ctx.project.id && next.vcs === ctx.project.vcs && next.worktree === ctx.project.worktree)
        return next
      yield* markInstanceForReload(ctx, {
        directory: ctx.directory,
        worktree: ctx.directory,
        project: next,
      })
      return next
    })

    const update = Effect.fn("ProjectHttpApi.update")(function* (ctx: {
      params: { projectID: ProjectV2.ID }
      payload: Project.UpdatePayload
    }) {
      return yield* svc.update({ ...ctx.payload, projectID: ctx.params.projectID }).pipe(
        Effect.catchTag("Project.NotFoundError", (error) =>
          Effect.fail(
            new ProjectNotFoundError({
              projectID: error.projectID,
              message: `Project not found: ${error.projectID}`,
            }),
          ),
        ),
      )
    })

    const directories = Effect.fn("ProjectHttpApi.directories")((ctx: { params: { projectID: ProjectV2.ID } }) =>
      project.directories({ projectID: ctx.params.projectID }),
    )

    return handlers
      .handle("list", list)
      .handle("create", create)
      .handle("managed", managed)
      .handle("managedRoot", managedRoot)
      .handle("managedStorage", managedStorage)
      .handle("deleteManaged", deleteManaged)
      .handle("current", current)
      .handle("initGit", initGit)
      .handle("update", update)
      .handle("directories", directories)
  }),
)
