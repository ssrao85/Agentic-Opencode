import { afterEach, describe, expect, test } from "bun:test"
import { ConfigProvider, Context, Effect, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import path from "path"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { FilePaths } from "../../src/server/routes/instance/httpapi/groups/file"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const context = Context.empty() as Context.Context<unknown>
const it = testEffect(CrossSpawnSpawner.defaultLayer)

function request(route: string, directory: string, query?: Record<string, string>, init?: RequestInit) {
  const url = new URL(`http://localhost${route}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value)
  }
  const headers = new Headers(init?.headers)
  headers.set("x-opencode-directory", directory)
  if (init?.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/octet-stream")
  }
  return HttpApiApp.webHandler().handler(
    new Request(url, {
      ...init,
      headers,
    }),
    context,
  )
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("file HttpApi", () => {
  test("serves read endpoints", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "hello.txt"), "hello\n")

    const [list, content, download, status] = await Promise.all([
      request(FilePaths.list, tmp.path, { path: "." }),
      request(FilePaths.content, tmp.path, { path: "hello.txt" }),
      request(FilePaths.download, tmp.path, { path: "hello.txt" }),
      request(FilePaths.status, tmp.path),
    ])

    expect(list.status).toBe(200)
    expect(await list.json()).toContainEqual(
      expect.objectContaining({ name: "hello.txt", path: "hello.txt", type: "file" }),
    )

    expect(content.status).toBe(200)
    expect(await content.json()).toMatchObject({ type: "text", content: "hello" })

    expect(download.status).toBe(200)
    expect(download.headers.get("content-type")).toContain("text/plain")
    expect(await download.text()).toBe("hello\n")

    expect(status.status).toBe(200)
    expect(await status.json()).toEqual([])
  })

  test("downloads exact binary file contents", async () => {
    await using tmp = await tmpdir({ git: true })
    const contents = new Uint8Array([0, 1, 2, 10, 255])
    await Bun.write(path.join(tmp.path, "artifact.bin"), contents)

    const download = await request(FilePaths.download, tmp.path, { path: "artifact.bin" })

    expect(download.status).toBe(200)
    expect(download.headers.get("content-type")).toContain("application/octet-stream")
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(contents)
  })

  test("downloads HTML and archive files with their original bytes and content types", async () => {
    await using tmp = await tmpdir({ git: true })
    const files = [
      { name: "page.html", type: "text/html", bytes: new TextEncoder().encode("<!doctype html>\n<h1>Hello</h1>\n") },
      { name: "archive.zip", type: "application/zip", bytes: new Uint8Array([80, 75, 3, 4, 0, 255]) },
      { name: "archive.tar.gz", type: "application/gzip", bytes: new Uint8Array([31, 139, 8, 0, 0, 255]) },
    ]
    await Promise.all(files.map((file) => Bun.write(path.join(tmp.path, file.name), file.bytes)))

    for (const file of files) {
      const download = await request(FilePaths.download, tmp.path, { path: file.name })
      expect(download.status).toBe(200)
      expect(download.headers.get("content-type")).toContain(file.type)
      expect(new Uint8Array(await download.arrayBuffer())).toEqual(file.bytes)
    }
  })

  test("uploads arbitrary bytes into the active workspace", async () => {
    await using tmp = await tmpdir({ git: true })
    const contents = new Uint8Array([80, 75, 3, 4, 0, 255])

    const response = await request(
      FilePaths.upload,
      tmp.path,
      { filename: "../unsafe\\archive.zip", mime: "application/zip" },
      { method: "POST", body: contents },
    )

    expect(response.status).toBe(200)
    const uploaded = (await response.json()) as { path: string; filename: string; mime: string; size: number }
    expect(uploaded).toMatchObject({ filename: "archive.zip", mime: "application/zip", size: contents.byteLength })
    expect(uploaded.path).toBe("archive.zip")
    expect(new Uint8Array(await Bun.file(path.join(tmp.path, uploaded.path)).arrayBuffer())).toEqual(contents)

    const replacement = Uint8Array.of(1, 2, 3)
    const replaced = await request(
      FilePaths.upload,
      tmp.path,
      { filename: "archive.zip", mime: "application/zip" },
      { method: "POST", body: replacement },
    )
    expect(replaced.status).toBe(200)
    expect(new Uint8Array(await Bun.file(path.join(tmp.path, "archive.zip")).arrayBuffer())).toEqual(replacement)

    const empty = await request(FilePaths.upload, tmp.path, { filename: "empty.txt" }, { method: "POST", body: "" })
    expect(empty.status).toBe(200)
    const emptyUpload = (await empty.json()) as { path: string; size: number }
    expect(emptyUpload.size).toBe(0)
    expect((await Bun.file(path.join(tmp.path, emptyUpload.path)).arrayBuffer()).byteLength).toBe(0)
  })

  test("rejects oversized and escaping uploads", async () => {
    await using tmp = await tmpdir({ git: true })
    await using outside = await tmpdir()

    const oversized = await request(
      FilePaths.upload,
      tmp.path,
      { filename: "large.bin" },
      { method: "POST", body: new Uint8Array(20 * 1024 * 1024 + 1) },
    )
    expect(oversized.status).toBe(400)

    await Bun.$`ln -s ${path.join(outside.path, "escape.bin")} ${path.join(tmp.path, "escape.bin")}`
    const escaping = await request(
      FilePaths.upload,
      tmp.path,
      { filename: "escape.bin" },
      { method: "POST", body: Uint8Array.of(1) },
    )
    expect(escaping.status).toBe(400)
    expect(await Bun.file(path.join(outside.path, "escape.bin")).exists()).toBe(false)
  })

  for (const limit of [4, 20 * 1024 * 1024 + 1]) {
    it.live(`enforces the configured upload limit of ${limit} bytes`, () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped({ git: true })
        const app = yield* Effect.acquireRelease(
          Effect.sync(() =>
            HttpRouter.toWebHandler(
              HttpApiApp.routes.pipe(
                Layer.provide(
                  ConfigProvider.layer(ConfigProvider.fromUnknown({ OPENCODE_MAX_FILE_UPLOAD_BYTES: String(limit) })),
                ),
              ),
              { disableLogger: true },
            ),
          ),
          (app) => Effect.promise(() => app.dispose()),
        )

        for (const size of [limit, limit + 1]) {
          const url = new URL(`http://localhost${FilePaths.upload}`)
          url.searchParams.set("filename", `${size}.bin`)
          const response = yield* Effect.promise(() =>
            Promise.resolve(
              app.handler(
                new Request(url, {
                  method: "POST",
                  headers: { "x-opencode-directory": tmp, "content-type": "application/octet-stream" },
                  body: new Uint8Array(size),
                }),
                context,
              ),
            ),
          )

          expect(response.status).toBe(size === limit ? 200 : 400)
          expect(yield* Effect.promise(() => Bun.file(path.join(tmp, `${size}.bin`)).exists())).toBe(size === limit)
        }
      }),
    )
  }

  test("serves search endpoints", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "hello.txt"), "needle")

    const [text, files, symbols] = await Promise.all([
      request(FilePaths.findText, tmp.path, { pattern: "needle" }),
      request(FilePaths.findFile, tmp.path, { query: "hello", type: "file" }),
      request(FilePaths.findSymbol, tmp.path, { query: "hello" }),
    ])

    expect(text.status).toBe(200)
    expect(await text.json()).toContainEqual(expect.objectContaining({ line_number: 1 }))

    expect(files.status).toBe(200)
    expect(await files.json()).toContain("hello.txt")

    expect(symbols.status).toBe(200)
    expect(await symbols.json()).toEqual([])
  })
})
