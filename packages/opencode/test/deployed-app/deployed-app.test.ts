import { NodeHttpServer } from "@effect/platform-node"
import { afterEach, describe, expect } from "bun:test"
import { Context, Effect, Layer, Option } from "effect"
import { HttpBody, HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import net from "node:net"
import path from "node:path"
import { MoveSession } from "@opencode-ai/core/control-plane/move-session"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { DeployedApp } from "../../src/deployed-app"
import { Installation } from "../../src/installation"
import { ServerAuth } from "../../src/server/auth"
import { RootHttpApi } from "../../src/server/routes/instance/httpapi/api"
import { controlHandlers } from "../../src/server/routes/instance/httpapi/handlers/control"
import { controlPlaneHandlers } from "../../src/server/routes/instance/httpapi/handlers/control-plane"
import { deployedAppHandlers } from "../../src/server/routes/instance/httpapi/handlers/deployed-app"
import { globalHandlers } from "../../src/server/routes/instance/httpapi/handlers/global"
import { authorizationLayer } from "../../src/server/routes/instance/httpapi/middleware/authorization"
import { schemaErrorLayer } from "../../src/server/routes/instance/httpapi/middleware/schema-error"
import { tmpdir } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const ENV = ["OPENCODE_APPS_REGISTRY", "OPENCODE_APPS_LOG_DIR", "OPENCODE_APPS_CLI"] as const
const previous = ENV.map((key) => [key, process.env[key]] as const)
afterEach(() => {
  previous.forEach(([key, value]) => {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  })
})

// Points opencode at a throwaway registry and at the real `apps` CLI from the
// container image, run with this test's Bun (the image runs it with node).
async function registry(dir: string, entries: Record<string, unknown>) {
  const file = path.join(dir, "apps.json")
  const cli = path.join(dir, "apps")
  process.env["OPENCODE_APPS_REGISTRY"] = file
  process.env["OPENCODE_APPS_LOG_DIR"] = path.join(dir, "logs")
  process.env["OPENCODE_APPS_CLI"] = cli
  await Bun.write(file, JSON.stringify(entries))
  await Bun.write(
    cli,
    `#!/bin/sh\nexec "${process.execPath}" "${path.join(import.meta.dir, "../../container/apps")}" "$@"\n`,
  )
  await Bun.$`chmod +x ${cli}`
  return file
}

function freePort() {
  return new Promise<number>((resolve) => {
    const server = net.createServer()
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      server.close(() => resolve(typeof address === "object" && address ? address.port : 0))
    })
  })
}

const apiLayer = HttpRouter.serve(
  HttpApiBuilder.layer(RootHttpApi).pipe(
    Layer.provide([controlHandlers, controlPlaneHandlers, deployedAppHandlers, globalHandlers]),
    Layer.provide([authorizationLayer, schemaErrorLayer]),
    // Raw HttpApi routes expose an opaque handler context at the request boundary.
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    HttpRouter.provideRequest(Layer.succeedContext(Context.empty() as Context.Context<unknown>)),
  ),
  { disableListenLog: true, disableLogger: true },
).pipe(
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provide(Layer.mock(Auth.Service)({})),
  Layer.provide(Layer.mock(Config.Service)({})),
  Layer.provide(Layer.mock(Installation.Service)({})),
  Layer.provide(Layer.mock(MoveSession.Service)({})),
  Layer.provide(ServerAuth.Config.layer({ password: Option.none(), username: "opencode" })),
)
const it = testEffect(apiLayer)

describe("DeployedApp", () => {
  it.live("lists registered apps with inferred framework, defaults and newest first", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.promise(() => tmpdir())
      yield* Effect.promise(() =>
        registry(tmp.path, {
          greet: { port: 8100, cmd: ["gunicorn", "app:app"], deployedAt: 1, autoRestart: true },
          "prism-chat": { port: 8105, cmd: ["/opt/venv/bin/uvicorn", "main:app"], deployedAt: 2 },
          legacy: { port: 8000 },
          broken: { cmd: ["x"] },
        }),
      )

      const response = yield* HttpClient.get("/deployed-app")
      expect(response.status).toBe(200)
      expect(yield* response.json).toEqual([
        {
          name: "prism-chat",
          path: "/apps/prism-chat/",
          port: 8105,
          status: "stopped",
          framework: "fastapi",
          deployedAt: 2,
          autoRestart: false,
          startable: true,
        },
        {
          name: "greet",
          path: "/apps/greet/",
          port: 8100,
          status: "stopped",
          framework: "flask",
          deployedAt: 1,
          autoRestart: true,
          startable: true,
        },
        {
          name: "legacy",
          path: "/apps/legacy/",
          port: 8000,
          status: "stopped",
          autoRestart: false,
          startable: false,
        },
      ])
      yield* Effect.promise(() => tmp[Symbol.asyncDispose]())
    }),
  )

  it.live("starts, stops, toggles auto-restart and removes an app through the apps CLI", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.promise(() => tmpdir())
      const port = yield* Effect.promise(() => freePort())
      const file = yield* Effect.promise(() =>
        registry(tmp.path, {
          demo: { port, cwd: tmp.path, cmd: [process.execPath, "-e", "setInterval(() => {}, 1000)"], deployedAt: 5 },
        }),
      )
      const entry = () => Effect.promise(() => Bun.file(file).json()).pipe(Effect.map((reg) => reg.demo))
      const json = (response: { json: Effect.Effect<unknown, unknown> }) => response.json

      const started = yield* HttpClient.post("/deployed-app/demo/start")
      expect(started.status).toBe(200)
      expect(yield* json(started)).toMatchObject({ status: "running", deployedAt: 5 })

      const stopped = yield* HttpClient.post("/deployed-app/demo/stop")
      expect(yield* json(stopped)).toMatchObject({ status: "stopped" })
      expect(yield* entry()).toMatchObject({ stopped: true })

      const updated = yield* HttpClientRequest.patch("/deployed-app/demo").pipe(
        HttpClientRequest.setBody(HttpBody.text(JSON.stringify({ autoRestart: true }), "application/json")),
        HttpClient.execute,
      )
      expect(yield* json(updated)).toMatchObject({ autoRestart: true, status: "stopped" })

      yield* HttpClient.post("/deployed-app/demo/start")
      expect(yield* entry()).not.toHaveProperty("stopped")

      const removed = yield* HttpClient.del("/deployed-app/demo")
      expect(removed.status).toBe(200)
      expect(yield* Effect.promise(() => Bun.file(file).json())).toEqual({})
      yield* Effect.promise(() => tmp[Symbol.asyncDispose]())
    }),
  )

  it.live("reports unknown apps and refusals from the apps CLI", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.promise(() => tmpdir())
      yield* Effect.promise(() => registry(tmp.path, { manual: { port: 8000 } }))

      expect((yield* HttpClient.post("/deployed-app/missing/start")).status).toBe(404)
      const manual = yield* HttpClient.post("/deployed-app/manual/start")
      expect(manual.status).toBe(409)
      expect(yield* manual.json).toMatchObject({ message: expect.stringContaining("no recorded start command") })
      yield* Effect.promise(() => tmp[Symbol.asyncDispose]())
    }),
  )

  it.live("prefers a recorded framework over the command", () =>
    Effect.sync(() => {
      expect(DeployedApp.inferFramework({ framework: "Streamlit", cmd: ["python", "x.py"] })).toBe("streamlit")
      expect(DeployedApp.inferFramework({ cmd: ["npx", "vite", "--port", "8101"] })).toBe("vite")
      expect(DeployedApp.inferFramework({ cmd: ["python3", "-m", "http.server", "8102"] })).toBe("static")
    }),
  )
})
