import { DeployedApp } from "@/deployed-app"
import { AppProcess } from "@opencode-ai/core/process"
import { Effect, Layer } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { ChildProcess } from "effect/unstable/process"
import { RootHttpApi } from "../api"
import { ConflictError, notFound } from "../errors"

export const deployedAppHandlers = HttpApiBuilder.group(RootHttpApi, "deployedApp", (handlers) =>
  Effect.gen(function* () {
    const appProcess = yield* AppProcess.Service

    // Every action goes through the `apps` CLI so launching, stopping and the
    // registry format stay owned by one implementation.
    const apps = Effect.fn("DeployedAppHttpApi.apps")(function* (name: string, args: string[]) {
      if (!DeployedApp.get(name)) return yield* notFound(`no such app: ${name}`)
      const result = yield* appProcess
        .run(ChildProcess.make(DeployedApp.cli(), args, { extendEnv: true }), { timeout: "30 seconds" })
        .pipe(
          Effect.mapError(
            (error) => new ConflictError({ message: `apps CLI failed: ${error.message}`, resource: "app" }),
          ),
        )
      if (result.exitCode === 0) return
      const message = result.stderr.toString("utf8").trim().replace(/^apps: /, "")
      if (message.startsWith("no such app")) return yield* notFound(message)
      return yield* new ConflictError({ message: message || `apps ${args[0]} failed`, resource: "app" })
    })

    const info = (name: string) =>
      Effect.suspend(() => {
        const app = DeployedApp.get(name)
        return app ? Effect.succeed(app) : Effect.fail(notFound(`no such app: ${name}`))
      })

    return handlers
      .handle("list", () => Effect.sync(() => DeployedApp.list()))
      .handle("start", (ctx) =>
        apps(ctx.params.name, ["start", ctx.params.name]).pipe(Effect.andThen(info(ctx.params.name))),
      )
      .handle("stop", (ctx) =>
        apps(ctx.params.name, ["stop", ctx.params.name]).pipe(Effect.andThen(info(ctx.params.name))),
      )
      .handle("update", (ctx) =>
        apps(ctx.params.name, ["set", ctx.params.name, "auto-restart", ctx.payload.autoRestart ? "on" : "off"]).pipe(
          Effect.andThen(info(ctx.params.name)),
        ),
      )
      .handle("remove", (ctx) => apps(ctx.params.name, ["kill", ctx.params.name]).pipe(Effect.as(true)))
  }),
).pipe(Layer.provide(AppProcess.defaultLayer))
