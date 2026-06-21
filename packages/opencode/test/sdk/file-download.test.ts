import { describe, expect, test } from "bun:test"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"

function responseFetch(bytes: Uint8Array | string, type: string) {
  const body = typeof bytes === "string" ? bytes : Uint8Array.from(bytes).buffer
  return Object.assign(() => Promise.resolve(new Response(body, { headers: { "content-type": type } })), {
    preconnect() {},
  })
}

describe("SDK file downloads", () => {
  for (const item of [
    { name: "page.html", type: "text/html; charset=utf-8", bytes: new TextEncoder().encode("<h1>Hello</h1>") },
    { name: "archive.zip", type: "application/zip", bytes: new Uint8Array([80, 75, 3, 4, 0, 255]) },
    { name: "archive.tar.gz", type: "application/gzip", bytes: new Uint8Array([31, 139, 8, 0, 0, 255]) },
  ]) {
    test(`preserves ${item.name} bytes`, async () => {
      const sdk = createOpencodeClient({
        baseUrl: "http://localhost",
        fetch: responseFetch(item.bytes, item.type),
      })

      const result = await sdk.file.download({ path: item.name }, { parseAs: "blob", throwOnError: true })

      expect(result.data).toBeInstanceOf(Blob)
      if (!(result.data instanceof Blob)) throw new Error("Expected file download to be a Blob")
      expect(new Uint8Array(await result.data.arrayBuffer())).toEqual(item.bytes)
    })
  }

  test("still rejects HTML fallback responses for regular API requests", async () => {
    const sdk = createOpencodeClient({
      baseUrl: "http://localhost",
      fetch: responseFetch("<html></html>", "text/html"),
    })

    await expect(sdk.file.read({ path: "page.html" })).rejects.toThrow("Request is not supported")
  })
})
