import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import path from "path"
import os from "os"
import { mergeDeep } from "remeda"
import { Global } from "@opencode-ai/core/global"
import { applyEdits, modify } from "jsonc-parser"
import { existsSync } from "fs"
import { isRecord } from "@/util/record"
import type { ConsoleState } from "@opencode-ai/core/v1/config/console-state"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { Context, Duration, Effect, Layer } from "effect"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { InvalidError } from "@opencode-ai/core/v1/config/error"
import { ConfigPermissionV1 } from "@opencode-ai/core/v1/config/permission"
import { ConfigPluginV1 } from "@opencode-ai/core/v1/config/plugin"
import { ConfigParse } from "./parse"
import { ConfigPlugin } from "./plugin"
import { ConfigVariable } from "./variable"

function normalizeLoadedConfig(data: unknown) {
  if (!isRecord(data)) return data
  const copy = { ...data }
  const hadLegacy = "theme" in copy || "keybinds" in copy || "tui" in copy
  if (!hadLegacy) return copy
  delete copy.theme
  delete copy.keybinds
  delete copy.tui
  return copy
}

async function resolveLoadedPlugins<T extends { plugin?: ConfigPluginV1.Spec[] }>(config: T, filepath: string) {
  if (!config.plugin) return config
  for (let i = 0; i < config.plugin.length; i++) {
    // Normalize path-like plugin specs while we still know which config file declared them.
    // This prevents `./plugin.ts` from being reinterpreted relative to some later merge location.
    config.plugin[i] = await ConfigPlugin.resolvePluginSpec(config.plugin[i], filepath)
  }
  return config
}

type Info = ConfigV1.Info & {
  plugin_origins?: ConfigPlugin.Origin[]
}

type State = {
  config: Info
  consoleState: ConsoleState
}

export interface Interface {
  readonly get: () => Effect.Effect<Info>
  readonly getGlobal: () => Effect.Effect<Info>
  readonly getConsoleState: () => Effect.Effect<ConsoleState>
  readonly update: (config: Info) => Effect.Effect<void>
  readonly updateGlobal: (config: Info) => Effect.Effect<{ info: Info; changed: boolean }>
  readonly invalidate: () => Effect.Effect<void>
  readonly directories: () => Effect.Effect<string[]>
  readonly waitForDependencies: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Config") {}

export const use = serviceUse(Service)

function globalConfigFile() {
  const candidates = ["opencode.jsonc", "opencode.json", "config.json"].map((file) =>
    path.join(Global.Path.config, file),
  )
  for (const file of candidates) {
    if (existsSync(file)) return file
  }
  return candidates[0]
}

function patchJsonc(input: string, patch: unknown, path: string[] = []): string {
  if (!isRecord(patch)) {
    const edits = modify(input, path, patch, {
      formattingOptions: {
        insertSpaces: true,
        tabSize: 2,
      },
    })
    return applyEdits(input, edits)
  }

  return Object.entries(patch).reduce((result, [key, value]) => patchJsonc(result, value, [...path, key]), input)
}

function writable(info: Info) {
  const { plugin_origins: _plugin_origins, ...next } = info
  return next
}

function writableGlobal(info: Info) {
  const next = writable(info)
  // When a user changes config from a value back to default in the Desktop app, we don't want to leave a blank `"shell": "",` key
  if ("shell" in next && next.shell === "") return { ...next, shell: undefined }
  return next
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const readConfigFile = (filepath: string) => fs.readFileStringSafe(filepath).pipe(Effect.orDie)

    const loadConfig = Effect.fnUntraced(function* (text: string, filepath: string) {
      const expanded = yield* Effect.promise(() => ConfigVariable.substitute({ text, type: "path", path: filepath }))
      const data = ConfigParse.schema(
        ConfigV1.Info,
        normalizeLoadedConfig(ConfigParse.jsonc(expanded, filepath)),
        filepath,
      )
      // The selected config may be mounted read-only. Loading must never rewrite it.
      return yield* Effect.promise(() => resolveLoadedPlugins(data, filepath))
    })

    // Optional reads are retained for the existing config update APIs, not configuration discovery.
    const loadFile = Effect.fnUntraced(function* (filepath: string) {
      const text = yield* readConfigFile(filepath)
      if (!text) return {} as Info
      return yield* loadConfig(text, filepath)
    })

    const loadGlobal = Effect.fnUntraced(function* () {
      const selected = process.env.OPENCODE_CONFIG_ONLY ?? "/etc/opencode/opencode.jsonc"
      if (!selected.trim()) {
        return yield* Effect.die(
          new InvalidError({ path: selected, message: "OPENCODE_CONFIG_ONLY must name a configuration file" }),
        )
      }
      const file = path.resolve(selected)
      yield* Effect.logInfo("loading exclusive config", { path: file })
      const text = yield* fs
        .readFileStringSafe(file)
        .pipe(
          Effect.catch((error) =>
            Effect.die(
              new InvalidError(
                { path: file, message: `Cannot read required configuration file: ${String(error)}` },
                { cause: error },
              ),
            ),
          ),
        )
      if (text === undefined) {
        return yield* Effect.die(
          new InvalidError({ path: file, message: "Required configuration file does not exist" }),
        )
      }
      if (!text.trim()) {
        return yield* Effect.die(new InvalidError({ path: file, message: "Required configuration file is empty" }))
      }
      const result: Info = yield* loadConfig(text, file)
      result.plugin_origins = ConfigPlugin.deduplicatePluginOrigins(
        (result.plugin ?? []).map((spec) => ({ spec, source: file, scope: "global" })),
      )
      if (result.plugin) result.plugin = result.plugin_origins.map((item) => item.spec)
      return result
    })

    // Never substitute defaults after a failure: the sole configuration source is required.
    const [cachedGlobal, invalidateGlobal] = yield* Effect.cachedInvalidateWithTTL(loadGlobal(), Duration.infinity)
    const getGlobal = Effect.fn("Config.getGlobal")(() => cachedGlobal)

    const state = yield* InstanceState.make<State>(
      Effect.fn("Config.state")(function* () {
        const result = structuredClone(yield* getGlobal())
        result.agent ??= {}
        result.mode ??= {}
        result.plugin ??= []

        for (const [name, mode] of Object.entries(result.mode)) {
          result.agent = mergeDeep(result.agent, { [name]: { ...mode, mode: "primary" as const } })
        }

        if (result.tools) {
          const perms: Record<string, ConfigPermissionV1.Action> = {}
          for (const [tool, enabled] of Object.entries(result.tools)) {
            const action: ConfigPermissionV1.Action = enabled ? "allow" : "deny"
            if (tool === "write" || tool === "edit" || tool === "patch") {
              perms.edit = action
              continue
            }
            perms[tool] = action
          }
          result.permission = mergeDeep(perms, result.permission ?? {})
        }

        if (!result.username) {
          result.username = yield* Effect.sync(() => os.userInfo().username || "user").pipe(
            Effect.catchCause(() => Effect.succeed("user")),
          )
        }
        if (result.autoshare === true && !result.share) result.share = "auto"

        return {
          config: result,
          consoleState: { consoleManagedProviders: [], switchableOrgCount: 0 },
        }
      }),
    )

    const get = Effect.fn("Config.get")(() => InstanceState.use(state, (s) => s.config))
    const getConsoleState = Effect.fn("Config.getConsoleState")(() => InstanceState.use(state, (s) => s.consoleState))
    // Returning no discovery directories also prevents implicit agents, commands, plugins, and tools.
    const directories = Effect.fn("Config.directories")(() => Effect.succeed<string[]>([]))
    const waitForDependencies = () => Effect.void

    const update = Effect.fn("Config.update")(function* (config: Info) {
      const dir = yield* InstanceState.directory
      const file = path.join(dir, "config.json")
      const existing = yield* loadFile(file)
      yield* fs
        .writeFileString(file, JSON.stringify(mergeDeep(writable(existing), writable(config)), null, 2))
        .pipe(Effect.orDie)
    })

    const invalidate = Effect.fn("Config.invalidate")(function* () {
      yield* invalidateGlobal
    })

    const updateGlobal = Effect.fn("Config.updateGlobal")(function* (config: Info) {
      const file = globalConfigFile()
      const before = (yield* readConfigFile(file)) ?? "{}"
      const patch = writableGlobal(config)

      let next: Info
      let changed: boolean
      if (!file.endsWith(".jsonc")) {
        const existing = ConfigParse.schema(ConfigV1.Info, ConfigParse.jsonc(before, file), file)
        const merged = mergeDeep(writable(existing), patch)
        const serialized = JSON.stringify(merged, null, 2)
        changed = serialized !== before
        if (changed) yield* fs.writeFileString(file, serialized).pipe(Effect.orDie)
        next = merged
      } else {
        const updated = patchJsonc(before, patch)
        next = ConfigParse.schema(ConfigV1.Info, ConfigParse.jsonc(updated, file), file)
        changed = updated !== before
        if (changed) yield* fs.writeFileString(file, updated).pipe(Effect.orDie)
      }

      if (changed) yield* invalidate()
      return { info: next, changed }
    })

    return Service.of({
      get,
      getGlobal,
      getConsoleState,
      update,
      updateGlobal,
      invalidate,
      directories,
      waitForDependencies,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(FSUtil.defaultLayer))

export const node = LayerNode.make(layer, [FSUtil.node])

export * as Config from "./config"
