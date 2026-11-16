import path from "path"
import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Config } from "@/config/config"
import { Agent } from "../../src/agent/agent"
import { testEffect } from "../lib/effect"
import { TestInstance } from "../fixture/fixture"

const it = testEffect(Layer.mergeAll(Config.defaultLayer, Agent.defaultLayer, CrossSpawnSpawner.defaultLayer))

it.instance(
  "agent color parsed from the explicitly selected config",
  () =>
    withSelectedConfig(
      Effect.gen(function* () {
        const cfg = yield* Config.use.get()
        expect(cfg.agent?.["build"]?.color).toBe("#FFA500")
        expect(cfg.agent?.["plan"]?.color).toBe("primary")
      }),
    ),
  {
    git: true,
    config: {
      agent: {
        build: { color: "#FFA500" },
        plan: { color: "primary" },
      },
    },
  },
)

it.instance(
  "Agent.get includes color from config",
  () =>
    withSelectedConfig(
      Effect.gen(function* () {
        const plan = yield* Agent.use.get("plan")
        expect(plan?.color).toBe("#A855F7")
        const build = yield* Agent.use.get("build")
        expect(build?.color).toBe("accent")
      }),
    ),
  {
    git: true,
    config: {
      agent: {
        plan: { color: "#A855F7" },
        build: { color: "accent" },
      },
    },
  },
)

function withSelectedConfig<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const instance = yield* TestInstance
    return yield* Effect.acquireUseRelease(
      Effect.sync(() => {
        const original = process.env.OPENCODE_CONFIG_ONLY
        process.env.OPENCODE_CONFIG_ONLY = path.join(instance.directory, "opencode.json")
        return original
      }),
      () => effect,
      (original) =>
        Effect.sync(() => {
          if (original === undefined) delete process.env.OPENCODE_CONFIG_ONLY
          if (original !== undefined) process.env.OPENCODE_CONFIG_ONLY = original
        }),
    )
  })
}
