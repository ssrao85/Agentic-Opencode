import { describe, expect, spyOn, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import os from "os"
import { pathToFileURL } from "url"
import { Cause, Effect, Exit, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { ConfigPluginV1 } from "@opencode-ai/core/v1/config/plugin"
import { Config } from "@/config/config"
import { ConfigManaged } from "@/config/managed"
import { ConfigParse } from "@/config/parse"
import { ConfigPlugin } from "@/config/plugin"
import { Filesystem } from "@/util/filesystem"
import { FormatError } from "@/cli/error"
import { TestInstance, provideInstanceEffect, tmpdir, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Config.defaultLayer, FSUtil.defaultLayer, CrossSpawnSpawner.defaultLayer))

function withEnvs<A, E, R>(entries: Record<string, string | undefined>, effect: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const originals = Object.fromEntries(Object.keys(entries).map((key) => [key, process.env[key]]))
      Object.entries(entries).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key]
        if (value !== undefined) process.env[key] = value
      })
      return originals
    }),
    () => effect,
    (originals) =>
      Effect.sync(() => {
        Object.entries(originals).forEach(([key, value]) => {
          if (value === undefined) delete process.env[key]
          if (value !== undefined) process.env[key] = value
        })
      }),
  )
}

function withConfig<A, E, R>(text: string, effect: (file: string) => Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    const file = path.join(dir, "selected.jsonc")
    yield* FSUtil.use.writeFileString(file, text)
    return yield* withEnvs({ OPENCODE_CONFIG_ONLY: file }, effect(file))
  })
}

describe("exclusive configuration", () => {
  it.live("defaults to /etc/opencode/opencode.jsonc without discovering or writing other files", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const read = spyOn(fs, "readFileStringSafe").mockImplementation((file) => {
        expect(file).toBe("/etc/opencode/opencode.jsonc")
        return Effect.succeed('{"model":"system/model"}')
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => read.mockRestore()))
      yield* withEnvs(
        { OPENCODE_CONFIG_ONLY: undefined },
        Effect.gen(function* () {
          expect((yield* Config.use.getGlobal()).model).toBe("system/model")
        }),
      )
      expect(read).toHaveBeenCalledTimes(1)
    }),
  )

  it.instance("loads the selected JSONC file for global and instance configuration without rewriting it", () =>
    withConfig(
      `{
 // administrator configuration
 "model": "system/model",
}`,
      (file) =>
        Effect.gen(function* () {
          const before = yield* FSUtil.use.readFileString(file)
          yield* FSUtil.use.chmod(file, 0o444)
          expect((yield* Config.use.getGlobal()).model).toBe("system/model")
          const config = yield* Config.use.get()
          expect(config.model).toBe("system/model")
          expect(config.username).toBe(os.userInfo().username || "user")
          expect(config.agent).toEqual({})
          expect(yield* Config.use.directories()).toEqual([])
          expect(yield* Config.use.getConsoleState()).toEqual({ consoleManagedProviders: [], switchableOrgCount: 0 })
          yield* Config.use.waitForDependencies()
          expect(yield* FSUtil.use.readFileString(file)).toBe(before)
        }),
    ),
  )

  it.instance("ignores project, ancestor, home, global, managed and environment configuration sources", () =>
    withConfig(
      '{"model":"system/model","permission":{"edit":"deny"},"compaction":{"auto":true,"prune":true}}',
      (file) =>
        Effect.gen(function* () {
          const instance = yield* TestInstance
          const root = yield* tmpdirScoped()
          const original = Global.Path.config
          yield* withEnvs(
            { OPENCODE_TEST_HOME: path.join(root, "home") },
            Effect.acquireUseRelease(
              Effect.sync(() => {
                Global.Path.config = path.join(root, "global")
              }),
              () =>
                Effect.gen(function* () {
                  yield* Effect.forEach(
                    [
                      path.join(instance.directory, "opencode.json"),
                      path.join(instance.directory, "opencode.jsonc"),
                      path.join(instance.directory, ".opencode", "opencode.jsonc"),
                      path.join(root, "opencode.jsonc"),
                      path.join(Global.Path.config, "config.json"),
                      path.join(Global.Path.config, "opencode.jsonc"),
                      path.join(Global.Path.home, ".opencode", "opencode.jsonc"),
                      path.join(root, "override", "opencode.jsonc"),
                      path.join(root, "managed", "opencode.jsonc"),
                      path.join(path.dirname(file), "opencode.json"),
                    ],
                    (candidate) =>
                      FSUtil.use.writeWithDirs(candidate, '{"model":"other/model","small_model":"other/small"}'),
                  )
                  yield* FSUtil.use.writeWithDirs(
                    path.join(instance.directory, ".opencode", "agents", "intruder.md"),
                    "---\nmode: primary\n---\nunwanted agent",
                  )
                  yield* FSUtil.use.writeWithDirs(
                    path.join(instance.directory, ".opencode", "commands", "intruder.md"),
                    "unwanted command",
                  )
                  yield* FSUtil.use.writeWithDirs(
                    path.join(instance.directory, ".opencode", "plugins", "intruder.ts"),
                    "throw new Error('unwanted plugin')",
                  )
                  yield* withEnvs(
                    {
                      OPENCODE_CONFIG: path.join(root, "opencode.jsonc"),
                      OPENCODE_CONFIG_DIR: path.join(root, "override"),
                      OPENCODE_CONFIG_CONTENT: '{"model":"inline/model","small_model":"inline/small"}',
                      OPENCODE_PERMISSION: '{"edit":"allow"}',
                      OPENCODE_DISABLE_AUTOCOMPACT: "true",
                      OPENCODE_DISABLE_PRUNE: "true",
                      OPENCODE_TEST_MANAGED_CONFIG_DIR: path.join(root, "managed"),
                    },
                    Effect.gen(function* () {
                      const config = yield* Config.use.get()
                      expect(config.model).toBe("system/model")
                      expect(config.small_model).toBeUndefined()
                      expect(config.permission).toEqual({ edit: "deny" })
                      expect(config.compaction).toEqual({ auto: true, prune: true })
                      expect(config.agent).toEqual({})
                      expect(config.command).toBeUndefined()
                      expect(config.plugin).toEqual([])
                      expect(config.plugin_origins).toEqual([])
                      expect(yield* Config.use.directories()).toEqual([])
                      expect(
                        yield* FSUtil.use.existsSafe(path.join(instance.directory, ".opencode", "package.json")),
                      ).toBe(false)
                    }),
                  )
                }),
              () =>
                Effect.sync(() => {
                  Global.Path.config = original
                }),
            ),
          )
        }),
    ),
  )

  it.instance("does not parse malformed unselected configs or inline overrides", () =>
    withConfig('{"model":"system/model"}', () =>
      Effect.gen(function* () {
        const instance = yield* TestInstance
        yield* FSUtil.use.writeWithDirs(path.join(instance.directory, "opencode.jsonc"), "{ invalid json")
        yield* FSUtil.use.writeWithDirs(path.join(instance.directory, ".opencode", "opencode.json"), "{ invalid json")
        yield* withEnvs(
          { OPENCODE_CONFIG_CONTENT: "{ invalid json", OPENCODE_PERMISSION: "{ invalid json" },
          Effect.gen(function* () {
            expect((yield* Config.use.get()).model).toBe("system/model")
          }),
        )
      }),
    ),
  )

  it.instance("fails for a missing selected file even when a valid project config exists", () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const file = path.join(instance.directory, "missing.jsonc")
      yield* FSUtil.use.writeJson(path.join(instance.directory, "opencode.jsonc"), { model: "project/model" })
      yield* withEnvs(
        { OPENCODE_CONFIG_ONLY: file },
        Effect.gen(function* () {
          const exit = yield* Effect.exit(Config.use.get())
          expect(Exit.isFailure(exit)).toBe(true)
          const message = Exit.isFailure(exit) ? FormatError(Cause.squash(exit.cause)) : ""
          expect(message).toContain(file)
          expect(message).toContain("does not exist")
          expect(yield* FSUtil.use.existsSafe(file)).toBe(false)
        }),
      )
    }),
  )

  it.live("does not fall back when the default system file is missing", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const read = spyOn(fs, "readFileStringSafe").mockImplementation((file) => {
        expect(file).toBe("/etc/opencode/opencode.jsonc")
        return Effect.succeed(undefined)
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => read.mockRestore()))
      yield* withEnvs(
        { OPENCODE_CONFIG_ONLY: undefined },
        Effect.gen(function* () {
          const exit = yield* Effect.exit(Config.use.getGlobal())
          expect(Exit.isFailure(exit)).toBe(true)
          const message = Exit.isFailure(exit) ? FormatError(Cause.squash(exit.cause)) : ""
          expect(message).toContain("/etc/opencode/opencode.jsonc")
          expect(message).toContain("does not exist")
        }),
      )
    }),
  )
  ;(process.getuid?.() === 0 || process.platform === "win32" ? it.instance.skip : it.instance)(
    "fails clearly for a file without read permission",
    () =>
      withConfig("{}", (file) =>
        Effect.acquireUseRelease(
          FSUtil.use.chmod(file, 0o000),
          () =>
            Effect.gen(function* () {
              const exit = yield* Effect.exit(Config.use.get())
              expect(Exit.isFailure(exit)).toBe(true)
              const message = Exit.isFailure(exit) ? FormatError(Cause.squash(exit.cause)) : ""
              expect(message).toContain(file)
              expect(message).toContain("Cannot read required configuration file")
            }),
          () => FSUtil.use.chmod(file, 0o600),
        ),
      ),
  )

  it.instance("fails clearly when the selected path is a directory", () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      yield* withEnvs(
        { OPENCODE_CONFIG_ONLY: instance.directory },
        Effect.gen(function* () {
          const exit = yield* Effect.exit(Config.use.get())
          expect(Exit.isFailure(exit)).toBe(true)
          expect(Exit.isFailure(exit) ? FormatError(Cause.squash(exit.cause)) : "").toContain(instance.directory)
        }),
      )
    }),
  )
  ;[
    { name: "empty", text: "", message: "empty" },
    { name: "whitespace-only", text: " \n\t", message: "empty" },
    { name: "comment-only", text: "// no configuration", message: "not valid JSON(C)" },
    { name: "malformed JSONC", text: '{"model":', message: "not valid JSON(C)" },
    { name: "invalid schema", text: '{"model": 12}', message: "model" },
    { name: "unknown setting", text: '{"unknown_setting":true}', message: "Unrecognized key" },
    { name: "null", text: "null", message: "Configuration is invalid" },
    { name: "array", text: "[]", message: "Configuration is invalid" },
  ].forEach(({ name, text, message }) => {
    it.instance(`fails clearly for ${name} configuration`, () =>
      withConfig(text, (file) =>
        Effect.gen(function* () {
          const exit = yield* Effect.exit(Config.use.get())
          expect(Exit.isFailure(exit)).toBe(true)
          const formatted = Exit.isFailure(exit) ? FormatError(Cause.squash(exit.cause)) : ""
          expect(formatted).toContain(file)
          expect(formatted).toContain(message)
          const global = yield* Effect.exit(Config.use.getGlobal())
          expect(Exit.isFailure(global)).toBe(true)
        }),
      ),
    )
  })

  it.live("rejects an explicitly empty override instead of falling back", () =>
    withEnvs(
      { OPENCODE_CONFIG_ONLY: "" },
      Effect.gen(function* () {
        const exit = yield* Effect.exit(Config.use.getGlobal())
        expect(Exit.isFailure(exit)).toBe(true)
        expect(Exit.isFailure(exit) ? FormatError(Cause.squash(exit.cause)) : "").toContain(
          "OPENCODE_CONFIG_ONLY must name",
        )
      }),
    ),
  )

  it.instance("retains explicit environment and file substitutions", () =>
    withConfig('{"model":"{env:EXCLUSIVE_TEST_MODEL}","instructions":["{file:instructions.txt}"]}', (file) =>
      Effect.gen(function* () {
        yield* FSUtil.use.writeFileString(
          path.join(path.dirname(file), "instructions.txt"),
          "administrator instructions",
        )
        yield* withEnvs(
          { EXCLUSIVE_TEST_MODEL: "system/model" },
          Effect.gen(function* () {
            const config = yield* Config.use.get()
            expect(config.model).toBe("system/model")
            expect(config.instructions).toEqual(["administrator instructions"])
          }),
        )
      }),
    ),
  )

  it.instance("resolves and deduplicates only explicitly declared plugins relative to the selected file", () =>
    withConfig('{"plugin":["./plugin.ts","demo@1.0.0",["demo@2.0.0",{"setting":true}]]}', (file) =>
      Effect.gen(function* () {
        yield* FSUtil.use.writeFileString(path.join(path.dirname(file), "plugin.ts"), "export default {}")
        const config = yield* Config.use.get()
        expect(config.plugin).toEqual([
          pathToFileURL(path.join(path.dirname(file), "plugin.ts")).href,
          ["demo@2.0.0", { setting: true }],
        ])
        expect(config.plugin_origins).toEqual(config.plugin?.map((spec) => ({ spec, source: file, scope: "global" })))
      }),
    ),
  )

  it.instance("preserves compatibility conversions and settings declared in the selected file", () =>
    withConfig(
      JSON.stringify({
        autoshare: true,
        mode: { custom: { prompt: "administrator prompt" } },
        command: { approved: { template: "approved command" } },
        tools: { write: false, bash: true },
        permission: { bash: "ask" },
        theme: "legacy-theme",
        keybinds: {},
        tui: {},
      }),
      () =>
        Effect.gen(function* () {
          const config = yield* Config.use.get()
          expect(config.share).toBe("auto")
          expect(config.agent?.custom).toMatchObject({ prompt: "administrator prompt", mode: "primary" })
          expect(config.command?.approved.template).toBe("approved command")
          expect(config.permission).toEqual({ edit: "deny", bash: "ask" })
        }),
    ),
  )

  it.live("reloads the required file after invalidation and propagates new errors", () =>
    withConfig('{"model":"system/first"}', (file) =>
      Effect.gen(function* () {
        expect((yield* Config.use.getGlobal()).model).toBe("system/first")
        yield* FSUtil.use.writeFileString(file, '{"model":"system/second"}')
        yield* Config.use.invalidate()
        expect((yield* Config.use.getGlobal()).model).toBe("system/second")
        yield* FSUtil.use.remove(file)
        yield* Config.use.invalidate()
        expect(Exit.isFailure(yield* Effect.exit(Config.use.getGlobal()))).toBe(true)
      }),
    ),
  )

  it.instance("retains project update writes without loading their settings", () =>
    withConfig('{"model":"system/model"}', (file) =>
      Effect.gen(function* () {
        const instance = yield* TestInstance
        yield* Config.use.update({ model: "project/model", shell: "" })
        expect(yield* FSUtil.use.readJson(path.join(instance.directory, "config.json"))).toEqual({
          model: "project/model",
          shell: "",
        })
        expect((yield* Config.use.get()).model).toBe("system/model")
        expect(yield* FSUtil.use.readFileString(file)).toBe('{"model":"system/model"}')
      }),
    ),
  )

  it.instance("keeps mutable instance settings isolated from the global config and other projects", () =>
    withConfig('{"agent":{"build":{"prompt":"administrator prompt"}}}', () =>
      Effect.gen(function* () {
        const config = yield* Config.use.get()
        const build = config.agent?.build
        expect(build).toBeDefined()
        if (build) build.prompt = "instance-only change"
        expect((yield* Config.use.getGlobal()).agent?.build?.prompt).toBe("administrator prompt")
        const directory = yield* tmpdirScoped()
        const other = yield* Config.use.get().pipe(provideInstanceEffect(directory))
        expect(other.agent?.build?.prompt).toBe("administrator prompt")
      }),
    ),
  )
  ;["json", "jsonc"].forEach((extension) => {
    it.live(`retains global ${extension} update writes without changing the selected configuration`, () =>
      withConfig('{"model":"system/model"}', (file) =>
        Effect.gen(function* () {
          const directory = yield* tmpdirScoped()
          const target = path.join(directory, `opencode.${extension}`)
          yield* FSUtil.use.writeFileString(
            target,
            extension === "jsonc" ? '{\n // keep comment\n "username":"original"\n}' : '{"username":"original"}',
          )
          yield* Effect.acquireUseRelease(
            Effect.sync(() => {
              const original = Global.Path.config
              Global.Path.config = directory
              return original
            }),
            () =>
              Effect.gen(function* () {
                const result = yield* Config.use.updateGlobal({ username: "updated", shell: "" })
                expect(result.changed).toBe(true)
                expect(result.info.username).toBe("updated")
                expect(result.info.shell).toBeUndefined()
                const text = yield* FSUtil.use.readFileString(target)
                expect(ConfigParse.jsonc(text, target)).toEqual({ username: "updated" })
                if (extension === "jsonc") expect(text).toContain("// keep comment")
                expect((yield* Config.use.getGlobal()).model).toBe("system/model")
                expect(yield* FSUtil.use.readFileString(file)).toBe('{"model":"system/model"}')
              }),
            (original) =>
              Effect.sync(() => {
                Global.Path.config = original
              }),
          )
        }),
      ),
    )
  })
})

test("config parser preserves permission order while rejecting unknown top-level keys", () => {
  const config = ConfigParse.schema(
    ConfigV1.Info,
    {
      permission: {
        bash: "allow",
        "*": "deny",
        edit: "ask",
      },
    },
    "test",
  )

  expect(Object.keys(config.permission!)).toEqual(["bash", "*", "edit"])
  try {
    ConfigParse.schema(ConfigV1.Info, { invalid_field: true }, "test")
    throw new Error("expected config parse to fail")
  } catch (err) {
    const error = err as { data?: { issues?: Array<{ code?: string; keys?: string[]; path?: string[] }> } }
    expect(error.data?.issues?.[0]).toMatchObject({ code: "unrecognized_keys", keys: ["invalid_field"], path: [] })
  }
})

describe("resolvePluginSpec", () => {
  test("keeps package specs unchanged", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "opencode.json")
    expect(await ConfigPlugin.resolvePluginSpec("oh-my-opencode@2.4.3", file)).toBe("oh-my-opencode@2.4.3")
    expect(await ConfigPlugin.resolvePluginSpec("@scope/pkg", file)).toBe("@scope/pkg")
  })

  test("resolves windows-style relative plugin directory specs", async () => {
    if (process.platform !== "win32") return

    await using tmp = await tmpdir({
      init: async (dir) => {
        const plugin = path.join(dir, "plugin")
        await fs.mkdir(plugin, { recursive: true })
        await Filesystem.write(path.join(plugin, "index.ts"), "export default {}")
      },
    })

    const file = path.join(tmp.path, "opencode.json")
    const hit = await ConfigPlugin.resolvePluginSpec(".\\plugin", file)
    expect(ConfigPlugin.pluginSpecifier(hit)).toBe(pathToFileURL(path.join(tmp.path, "plugin", "index.ts")).href)
  })

  test("resolves relative file plugin paths to file urls", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Filesystem.write(path.join(dir, "plugin.ts"), "export default {}")
      },
    })

    const file = path.join(tmp.path, "opencode.json")
    const hit = await ConfigPlugin.resolvePluginSpec("./plugin.ts", file)
    expect(ConfigPlugin.pluginSpecifier(hit)).toBe(pathToFileURL(path.join(tmp.path, "plugin.ts")).href)
  })

  test("resolves plugin directory paths to directory urls", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const plugin = path.join(dir, "plugin")
        await fs.mkdir(plugin, { recursive: true })
        await Filesystem.writeJson(path.join(plugin, "package.json"), {
          name: "demo-plugin",
          type: "module",
          main: "./index.ts",
        })
        await Filesystem.write(path.join(plugin, "index.ts"), "export default {}")
      },
    })

    const file = path.join(tmp.path, "opencode.json")
    const hit = await ConfigPlugin.resolvePluginSpec("./plugin", file)
    expect(ConfigPlugin.pluginSpecifier(hit)).toBe(pathToFileURL(path.join(tmp.path, "plugin")).href)
  })

  test("resolves plugin directories without package.json to index.ts", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const plugin = path.join(dir, "plugin")
        await fs.mkdir(plugin, { recursive: true })
        await Filesystem.write(path.join(plugin, "index.ts"), "export default {}")
      },
    })

    const file = path.join(tmp.path, "opencode.json")
    const hit = await ConfigPlugin.resolvePluginSpec("./plugin", file)
    expect(ConfigPlugin.pluginSpecifier(hit)).toBe(pathToFileURL(path.join(tmp.path, "plugin", "index.ts")).href)
  })
})

describe("deduplicatePluginOrigins", () => {
  const dedupe = (plugins: ConfigPluginV1.Spec[]) =>
    ConfigPlugin.deduplicatePluginOrigins(
      plugins.map((spec) => ({
        spec,
        source: "",
        scope: "global" as const,
      })),
    ).map((item) => item.spec)

  test("removes duplicates keeping higher priority (later entries)", () => {
    const plugins = ["global-plugin@1.0.0", "shared-plugin@1.0.0", "local-plugin@2.0.0", "shared-plugin@2.0.0"]

    const result = dedupe(plugins)

    expect(result).toContain("global-plugin@1.0.0")
    expect(result).toContain("local-plugin@2.0.0")
    expect(result).toContain("shared-plugin@2.0.0")
    expect(result).not.toContain("shared-plugin@1.0.0")
    expect(result.length).toBe(3)
  })

  test("keeps path plugins separate from package plugins", () => {
    const plugins = ["oh-my-opencode@2.4.3", "file:///project/.opencode/plugin/oh-my-opencode.js"]

    const result = dedupe(plugins)

    expect(result).toEqual(plugins)
  })

  test("deduplicates direct path plugins by exact spec", () => {
    const plugins = ["file:///project/.opencode/plugin/demo.ts", "file:///project/.opencode/plugin/demo.ts"]

    const result = dedupe(plugins)

    expect(result).toEqual(["file:///project/.opencode/plugin/demo.ts"])
  })

  test("preserves order of remaining plugins", () => {
    const plugins = ["a-plugin@1.0.0", "b-plugin@1.0.0", "c-plugin@1.0.0"]

    const result = dedupe(plugins)

    expect(result).toEqual(["a-plugin@1.0.0", "b-plugin@1.0.0", "c-plugin@1.0.0"])
  })
})

test("parseManagedPlist strips MDM metadata keys", async () => {
  const config = ConfigParse.schema(
    ConfigV1.Info,
    ConfigParse.jsonc(
      await ConfigManaged.parseManagedPlist(
        JSON.stringify({
          PayloadDisplayName: "OpenCode Managed",
          PayloadIdentifier: "ai.opencode.managed.test",
          PayloadType: "ai.opencode.managed",
          PayloadUUID: "AAAA-BBBB-CCCC",
          PayloadVersion: 1,
          _manualProfile: true,
          share: "disabled",
          model: "mdm/model",
        }),
      ),
      "test:mobileconfig",
    ),
    "test:mobileconfig",
  )
  expect(config.share).toBe("disabled")
  expect(config.model).toBe("mdm/model")
  // MDM keys must not leak into the parsed config
  expect((config as any).PayloadUUID).toBeUndefined()
  expect((config as any).PayloadType).toBeUndefined()
  expect((config as any)._manualProfile).toBeUndefined()
})

test("parseManagedPlist parses server settings", async () => {
  const config = ConfigParse.schema(
    ConfigV1.Info,
    ConfigParse.jsonc(
      await ConfigManaged.parseManagedPlist(
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          server: { hostname: "127.0.0.1", mdns: false },
          autoupdate: true,
        }),
      ),
      "test:mobileconfig",
    ),
    "test:mobileconfig",
  )
  expect(config.server?.hostname).toBe("127.0.0.1")
  expect(config.server?.mdns).toBe(false)
  expect(config.autoupdate).toBe(true)
})

test("parseManagedPlist parses permission rules", async () => {
  const config = ConfigParse.schema(
    ConfigV1.Info,
    ConfigParse.jsonc(
      await ConfigManaged.parseManagedPlist(
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          permission: {
            "*": "ask",
            bash: { "*": "ask", "rm -rf *": "deny", "curl *": "deny" },
            grep: "allow",
            glob: "allow",
            webfetch: "ask",
            "~/.ssh/*": "deny",
          },
        }),
      ),
      "test:mobileconfig",
    ),
    "test:mobileconfig",
  )
  expect(config.permission?.["*"]).toBe("ask")
  expect(config.permission?.grep).toBe("allow")
  expect(config.permission?.webfetch).toBe("ask")
  expect(config.permission?.["~/.ssh/*"]).toBe("deny")
  const bash = config.permission?.bash as Record<string, string>
  expect(bash?.["rm -rf *"]).toBe("deny")
  expect(bash?.["curl *"]).toBe("deny")
})

test("parseManagedPlist parses enabled_providers", async () => {
  const config = ConfigParse.schema(
    ConfigV1.Info,
    ConfigParse.jsonc(
      await ConfigManaged.parseManagedPlist(
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          enabled_providers: ["anthropic", "google"],
        }),
      ),
      "test:mobileconfig",
    ),
    "test:mobileconfig",
  )
  expect(config.enabled_providers).toEqual(["anthropic", "google"])
})

test("parseManagedPlist handles empty config", async () => {
  const config = ConfigParse.schema(
    ConfigV1.Info,
    ConfigParse.jsonc(
      await ConfigManaged.parseManagedPlist(JSON.stringify({ $schema: "https://opencode.ai/config.json" })),
      "test:mobileconfig",
    ),
    "test:mobileconfig",
  )
  expect(config.$schema).toBe("https://opencode.ai/config.json")
})
