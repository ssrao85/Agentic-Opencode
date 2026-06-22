import { afterEach, describe, expect } from "bun:test"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect, Layer } from "effect"
import { HttpClientResponse } from "effect/unstable/http"
import path from "path"
import { GlobalBus, type GlobalEvent } from "../../src/bus/global"
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { Snapshot } from "../../src/snapshot"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))
const testInstanceStore = InstanceStore.defaultLayer.pipe(Layer.provide(noopBootstrap))
const it = testEffect(Layer.mergeAll(FSUtil.defaultLayer, Snapshot.defaultLayer, testInstanceStore, httpApiLayer))

type ManagedWorkspace = {
  id: string
  directory: string
  time: { created: number; updated: number }
}

function json<T>(response: HttpClientResponse.HttpClientResponse) {
  return response.json.pipe(Effect.map((value) => value as T))
}

function collectGlobalEvents() {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const seen: GlobalEvent[] = []
      const on = (event: GlobalEvent) => seen.push(event)
      GlobalBus.on("event", on)
      return { seen, on }
    }),
    ({ on }) => Effect.sync(() => GlobalBus.off("event", on)),
  )
}

describe("managed project workspaces", () => {
  it.instance("backfills, creates, and lists shared workspace directories", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const fs = yield* FSUtil.Service
      const root = path.join(test.directory, "all-workspaces")
      const existing = path.join(root, "existing")
      const previous = process.env.OPENCODE_WORKSPACE_ROOT
      process.env.OPENCODE_WORKSPACE_ROOT = root
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (previous === undefined) delete process.env.OPENCODE_WORKSPACE_ROOT
          if (previous !== undefined) process.env.OPENCODE_WORKSPACE_ROOT = previous
        }),
      )
      yield* fs.ensureDir(existing)

      const initial = yield* requestInDirectory("/project/managed", test.directory)
      expect(initial.status).toBe(200)
      expect((yield* json<ManagedWorkspace[]>(initial)).map((item) => item.directory)).toEqual([existing])

      const events = yield* collectGlobalEvents()
      const createdResponse = yield* requestInDirectory("/project", test.directory, { method: "POST" })
      expect(createdResponse.status).toBe(200)
      const created = yield* json<ManagedWorkspace>(createdResponse)
      expect(path.dirname(created.directory)).toBe(root)
      expect(yield* fs.isDir(created.directory)).toBe(true)

      const listed = yield* requestInDirectory("/project/managed", test.directory)
      expect((yield* json<ManagedWorkspace[]>(listed)).map((item) => item.directory)).toEqual([
        created.directory,
        existing,
      ])
      expect(
        events.seen.some(
          (event) =>
            event.directory === "global" &&
            event.payload.type === "managed.workspace.created" &&
            event.payload.properties.directory === created.directory,
        ),
      ).toBe(true)
    }),
  )
})
