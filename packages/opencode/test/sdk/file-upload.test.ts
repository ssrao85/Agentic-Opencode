import { describe, expect, test } from "bun:test"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"

describe("SDK file uploads", () => {
  test("sends exact file bytes with the workspace upload metadata", async () => {
    const contents = new Uint8Array([80, 75, 3, 4, 0, 255])
    const observed = Promise.withResolvers<{ request: Request; bytes: Uint8Array }>()
    const fetcher = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init)
        observed.resolve({ request, bytes: new Uint8Array(await request.arrayBuffer()) })
        return new Response(
          JSON.stringify({
            path: "archive.zip",
            filename: "archive.zip",
            mime: "application/zip",
            size: contents.byteLength,
          }),
          { headers: { "content-type": "application/json" } },
        )
      },
      { preconnect() {} },
    )
    const sdk = createOpencodeClient({ baseUrl: "http://localhost", directory: "/workspace", fetch: fetcher })

    const result = await sdk.file.upload(
      {
        filename: "archive.zip",
        mime: "application/zip",
        body: new File([contents], "archive.zip", { type: "application/zip" }),
      },
      { throwOnError: true },
    )
    const upload = await observed.promise

    expect(upload.request.method).toBe("POST")
    expect(upload.request.headers.get("content-type")).toBe("application/octet-stream")
    expect(upload.request.headers.get("x-opencode-directory")).toBe(encodeURIComponent("/workspace"))
    expect(new URL(upload.request.url).searchParams.get("filename")).toBe("archive.zip")
    expect(new URL(upload.request.url).searchParams.get("mime")).toBe("application/zip")
    expect(upload.bytes).toEqual(contents)
    expect(result.data?.path).toBe("archive.zip")
  })
})
