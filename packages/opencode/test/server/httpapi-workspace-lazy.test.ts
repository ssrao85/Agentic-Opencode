import { afterEach, describe, expect } from "bun:test"
import { Effect, FileSystem, Layer } from "effect"
import { HttpClientResponse } from "effect/unstable/http"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import path from "node:path"
import { GlobalBus, type GlobalEvent } from "../../src/bus/global"
import { Project } from "../../src/project/project"
import { Session } from "../../src/session/session"
import { MessageID, PartID } from "../../src/session/schema"
import { resetDatabase } from "../fixture/db"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

afterEach(() => resetDatabase())

const it = testEffect(Layer.mergeAll(Session.defaultLayer, httpApiLayer))

function json<T>(response: HttpClientResponse.HttpClientResponse) {
  expect(response.status).toBe(200)
  return response.json.pipe(Effect.map((value) => value as T))
}

function collectDisposals() {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const directories: string[] = []
      const on = (event: GlobalEvent) => {
        if (event.payload.type === "server.instance.disposed" && event.directory) directories.push(event.directory)
      }
      GlobalBus.on("event", on)
      return { directories, on }
    }),
    (events) => Effect.sync(() => GlobalBus.off("event", events.on)),
  )
}

describe("lazy workspace runtimes", () => {
  it.live(
    "keeps eight workspaces cold for catalog and metadata requests, then activates only the selected workspace",
    () =>
      Effect.gen(function* () {
        const root = yield* tmpdirScoped()
        const previous = process.env.OPENCODE_WORKSPACE_ROOT
        process.env.OPENCODE_WORKSPACE_ROOT = root
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            if (previous === undefined) delete process.env.OPENCODE_WORKSPACE_ROOT
            if (previous !== undefined) process.env.OPENCODE_WORKSPACE_ROOT = previous
          }),
        )
        const fs = yield* FileSystem.FileSystem
        const directories = yield* Effect.forEach(Array.from({ length: 8 }), (_, index) =>
          Effect.gen(function* () {
            const directory = path.join(root, String(index))
            yield* fs.copy(yield* tmpdirScoped({ git: true }), directory)
            return directory
          }),
        )
        const events = yield* collectDisposals()
        const managed = yield* json<Project.ManagedWorkspace[]>(yield* requestInDirectory("/project/managed", root))
        expect(managed).toHaveLength(8)
        const created = yield* json<Project.ManagedWorkspace>(
          yield* requestInDirectory("/project", root, { method: "POST" }),
        )
        expect(path.dirname(created.directory)).toBe(root)

        yield* Effect.forEach(
          ["/project", "/project/managed/root", "/project/managed/storage", "/global/health"],
          (route) => requestInDirectory(route, root).pipe(Effect.flatMap(json)),
        )
        yield* Effect.forEach(
          directories,
          (directory) =>
            Effect.gen(function* () {
              const project = yield* json<Project.Info>(yield* requestInDirectory("/project/current", directory))
              const updated = yield* json<Project.Info>(
                yield* requestInDirectory(`/project/${project.id}`, directory, {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ icon: { color: "pink" } }),
                }),
              )
              expect(updated.icon?.color).toBe("pink")
              expect(yield* json(yield* requestInDirectory("/path", directory))).toMatchObject({ directory })
              yield* json(yield* requestInDirectory(`/project/${project.id}/directories`, directory))
              yield* Effect.forEach(
                [
                  `/session?directory=${encodeURIComponent(directory)}`,
                  `/experimental/session?directory=${encodeURIComponent(directory)}`,
                  "/experimental/worktree",
                ],
                (route) =>
                  Effect.gen(function* () {
                    expect(yield* json(yield* requestInDirectory(route, directory))).toEqual([])
                  }),
              )
              expect(yield* json(yield* requestInDirectory("/session/status", directory))).toEqual({})
            }),
          { concurrency: "unbounded", discard: true },
        )

        // Disposal reports the real InstanceStore entries; metadata must leave it empty.
        yield* json(yield* requestInDirectory("/global/dispose", root, { method: "POST" }))
        expect(events.directories).toEqual([])
        const agents = yield* json<Array<{ name: string }>>(yield* requestInDirectory("/agent", directories[0]!))
        expect(agents.some((agent) => agent.name === "build")).toBe(true)
        yield* json(yield* requestInDirectory("/global/dispose", root, { method: "POST" }))
        expect(events.directories).toEqual([directories[0]!])
      }),
  )

  it.live("reads persisted sessions and history after disposal without reactivating their workspaces", () =>
    Effect.gen(function* () {
      const directories = yield* Effect.forEach(Array.from({ length: 2 }), () => tmpdirScoped())
      const sessions = yield* Effect.forEach(directories, (directory) =>
        requestInDirectory("/session", directory, { method: "POST" }).pipe(Effect.flatMap(json<Session.Info>)),
      )
      const child = yield* json<Session.Info>(
        yield* requestInDirectory("/session", directories[0]!, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ parentID: sessions[0]!.id }),
        }),
      )
      const messages = yield* Effect.forEach(sessions, (session) =>
        Effect.gen(function* () {
          const info = yield* Session.use.updateMessage({
            id: MessageID.ascending(),
            sessionID: session.id,
            role: "user",
            agent: "build",
            model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
            time: { created: Date.now() },
          })
          const part = yield* Session.use.updatePart({
            id: PartID.ascending(),
            sessionID: session.id,
            messageID: info.id,
            type: "text",
            text: "Persisted history",
          })
          return { info, parts: [part] }
        }),
      )
      yield* json(yield* requestInDirectory("/global/dispose", directories[0]!, { method: "POST" }))
      const events = yield* collectDisposals()

      yield* Effect.forEach(sessions, (session, index) =>
        Effect.gen(function* () {
          const listed = yield* json<Session.Info[]>(
            yield* requestInDirectory(
              `/session?directory=${encodeURIComponent(session.directory)}&roots=true`,
              session.directory,
            ),
          )
          expect(listed.map((item) => item.id)).toEqual([session.id])
          expect(yield* json(yield* requestInDirectory(`/session/${session.id}`, session.directory))).toMatchObject({
            id: session.id,
            directory: session.directory,
          })
          yield* Effect.forEach(["todo", "diff"], (route) =>
            Effect.gen(function* () {
              expect(
                yield* json(yield* requestInDirectory(`/session/${session.id}/${route}`, session.directory)),
              ).toEqual([])
            }),
          )
          const history = yield* json<SessionV1.WithParts[]>(
            yield* requestInDirectory(`/session/${session.id}/message?limit=10`, session.directory),
          )
          expect(history).toEqual([messages[index]!])
          expect(
            yield* json(
              yield* requestInDirectory(
                `/session/${session.id}/message/${messages[index]!.info.id}`,
                session.directory,
              ),
            ),
          ).toEqual(messages[index]!)
        }),
      )
      const children = yield* json<Session.Info[]>(
        yield* requestInDirectory(`/session/${sessions[0]!.id}/children`, directories[0]!),
      )
      expect(children.map((session) => session.id)).toEqual([child.id])
      yield* json(yield* requestInDirectory("/global/dispose", directories[0]!, { method: "POST" }))
      expect(events.directories).toEqual([])
    }),
  )
})
