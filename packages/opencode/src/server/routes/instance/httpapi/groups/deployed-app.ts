import { DeployedApp } from "@/deployed-app"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ApiNotFoundError, ConflictError } from "../errors"
import { described } from "./metadata"

const NameParams = Schema.Struct({
  name: Schema.String,
})

export const DeployedAppUpdateInput = Schema.Struct({
  autoRestart: Schema.Boolean.annotate({ description: "Relaunch the app whenever it exits on its own" }),
})

export const DeployedAppPaths = {
  list: "/deployed-app",
  app: "/deployed-app/:name",
  start: "/deployed-app/:name/start",
  stop: "/deployed-app/:name/stop",
} as const

export const DeployedAppApi = HttpApi.make("deployedApp").add(
  HttpApiGroup.make("deployedApp")
    .add(
      HttpApiEndpoint.get("list", DeployedAppPaths.list, {
        success: described(Schema.Array(DeployedApp.Info), "Deployed apps"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "deployedApp.list",
          summary: "List deployed apps",
          description: "List web apps registered under /apps/<name>/ with their live status.",
        }),
      ),
      HttpApiEndpoint.post("start", DeployedAppPaths.start, {
        params: NameParams,
        success: described(DeployedApp.Info, "Started app"),
        error: [ApiNotFoundError, ConflictError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "deployedApp.start",
          summary: "Start deployed app",
          description: "Relaunch a stopped app with its recorded command, working directory and port.",
        }),
      ),
      HttpApiEndpoint.post("stop", DeployedAppPaths.stop, {
        params: NameParams,
        success: described(DeployedApp.Info, "Stopped app"),
        error: [ApiNotFoundError, ConflictError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "deployedApp.stop",
          summary: "Stop deployed app",
          description: "Stop a running app and keep it stopped across restarts until it is started again.",
        }),
      ),
      HttpApiEndpoint.patch("update", DeployedAppPaths.app, {
        params: NameParams,
        payload: DeployedAppUpdateInput,
        success: described(DeployedApp.Info, "Updated app"),
        error: [ApiNotFoundError, ConflictError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "deployedApp.update",
          summary: "Update deployed app",
          description: "Change per-app settings such as auto-restart.",
        }),
      ),
      HttpApiEndpoint.delete("remove", DeployedAppPaths.app, {
        params: NameParams,
        success: described(Schema.Boolean, "App stopped and unregistered"),
        error: [ApiNotFoundError, ConflictError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "deployedApp.remove",
          summary: "Remove deployed app",
          description: "Stop the app and remove it from the registry. Its source files are left untouched.",
        }),
      ),
    )
    .annotateMerge(OpenApi.annotations({ title: "deployedApp", description: "Deployed web app routes." })),
)
