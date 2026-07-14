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

type ManagedWorkspaceRoot = {
  directory: string
}

type ManagedStorage = {
  total: number
  used: number
  available: number
  remaining: number
  usedPercent: number
  remainingPercent: number
  state: "healthy" | "warning" | "critical"
  updatedAt: number
  refreshIntervalMs: number
}

type SessionInfo = {
  id: string
  directory: string
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

      const rootResponse = yield* requestInDirectory("/project/managed/root", test.directory)
      expect(rootResponse.status).toBe(200)
      expect((yield* json<ManagedWorkspaceRoot>(rootResponse)).directory).toBe(root)

      const initial = yield* requestInDirectory("/project/managed", test.directory)
      expect(initial.status).toBe(200)
      expect((yield* json<ManagedWorkspace[]>(initial)).map((item) => item.directory)).toEqual([existing])

      const events = yield* collectGlobalEvents()
      const createdResponse = yield* requestInDirectory("/project", test.directory, { method: "POST" })
      expect(createdResponse.status).toBe(200)
      const created = yield* json<ManagedWorkspace>(createdResponse)
      expect(path.dirname(created.directory)).toBe(root)
      expect(yield* fs.isDir(created.directory)).toBe(true)

      const sessionResponse = yield* requestInDirectory("/session", created.directory, { method: "POST" })
      expect(sessionResponse.status).toBe(200)
      const session = yield* json<SessionInfo>(sessionResponse)
      expect(session.directory).toBe(created.directory)

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

      const deleteResponse = yield* requestInDirectory(`/project/managed/${created.id}`, created.directory, {
        method: "DELETE",
      })
      expect(deleteResponse.status).toBe(200)
      const deleted = yield* json<ManagedWorkspace>(deleteResponse)
      expect(deleted.id).toBe(created.id)
      expect(deleted.directory).toBe(created.directory)
      expect(yield* fs.isDir(created.directory)).toBe(false)

      const afterDelete = yield* requestInDirectory("/project/managed", test.directory)
      expect((yield* json<ManagedWorkspace[]>(afterDelete)).map((item) => item.directory)).toEqual([existing])

      const sessionsAfterDelete = yield* requestInDirectory(
        `/session?directory=${encodeURIComponent(created.directory)}`,
        test.directory,
      )
      expect(sessionsAfterDelete.status).toBe(200)
      expect((yield* json<SessionInfo[]>(sessionsAfterDelete)).map((item) => item.id)).not.toContain(session.id)

      expect(
        events.seen.some(
          (event) =>
            event.directory === "global" &&
            event.payload.type === "managed.workspace.deleted" &&
            event.payload.properties.directory === created.directory,
        ),
      ).toBe(true)
    }),
  )

  it.instance("returns storage totals with configured thresholds and a short cache", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const fs = yield* FSUtil.Service
      const root = path.join(test.directory, "all-workspaces")
      const previousPath = process.env.WORKSPACE_PATH
      const previousRefresh = process.env.STORAGE_REFRESH_INTERVAL_MS
      const previousWarning = process.env.STORAGE_WARNING_PERCENT
      const previousCritical = process.env.STORAGE_CRITICAL_PERCENT
      process.env.WORKSPACE_PATH = root
      process.env.STORAGE_REFRESH_INTERVAL_MS = "12345"
      process.env.STORAGE_WARNING_PERCENT = "100"
      process.env.STORAGE_CRITICAL_PERCENT = "0"
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (previousPath === undefined) delete process.env.WORKSPACE_PATH
          if (previousPath !== undefined) process.env.WORKSPACE_PATH = previousPath
          if (previousRefresh === undefined) delete process.env.STORAGE_REFRESH_INTERVAL_MS
          if (previousRefresh !== undefined) process.env.STORAGE_REFRESH_INTERVAL_MS = previousRefresh
          if (previousWarning === undefined) delete process.env.STORAGE_WARNING_PERCENT
          if (previousWarning !== undefined) process.env.STORAGE_WARNING_PERCENT = previousWarning
          if (previousCritical === undefined) delete process.env.STORAGE_CRITICAL_PERCENT
          if (previousCritical !== undefined) process.env.STORAGE_CRITICAL_PERCENT = previousCritical
        }),
      )
      yield* fs.ensureDir(root)

      const firstResponse = yield* requestInDirectory("/project/managed/storage", test.directory)
      expect(firstResponse.status).toBe(200)
      const first = yield* json<ManagedStorage>(firstResponse)
      expect(first.total).toBeGreaterThan(0)
      expect(first.remaining).toBeGreaterThan(0)
      expect(first.available).toBe(first.remaining)
      expect(first.used).toBe(first.total - first.remaining)
      expect(first.usedPercent).toBeGreaterThanOrEqual(0)
      expect(first.remainingPercent).toBeGreaterThan(0)
      expect(first.refreshIntervalMs).toBe(12345)
      expect(first.state).toBe("warning")

      const secondResponse = yield* requestInDirectory("/project/managed/storage", test.directory)
      expect(secondResponse.status).toBe(200)
      expect((yield* json<ManagedStorage>(secondResponse)).updatedAt).toBe(first.updatedAt)
    }),
  )
})
