import * as fs from "node:fs"
import { Effect } from "effect"
import { HttpClient, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import * as Socket from "effect/unstable/socket/Socket"
import { HttpApiProxy } from "./middleware/proxy"

// Path-based reverse proxy for user-launched apps.
//
// opencode is the only port exposed by the OpenShift Route (3000). Apps that the
// user vibe-codes (a FastAPI on :5000, a Vite dev server on :5173, ...) bind to
// loopback inside the same pod and would otherwise be unreachable from outside.
// This route multiplexes them onto opencode's single port under /apps/<name>/*,
// reusing opencode's HTTP+WebSocket proxy and its Basic-auth gate.
//
// The name -> port mapping lives in a small JSON registry on the persistent
// volume; the `apps` CLI maintains it. The registry is read per request (the file
// is tiny and request volume to apps is low) so newly registered apps are picked
// up without restarting opencode.

export const APPS_PREFIX = "/apps"

type AppEntry = { readonly port: number }
type Registry = Record<string, AppEntry>

function registryPath(): string {
  return process.env["OPENCODE_APPS_REGISTRY"] ?? "/all-workspaces/apps.json"
}

function readRegistry(): Registry {
  try {
    const parsed = JSON.parse(fs.readFileSync(registryPath(), "utf8")) as Registry
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

// "/apps/api/foo?x=1" -> { name: "api", tail: "/foo" }
// "/apps/api"         -> { name: "api", tail: "" }
function parseAppPath(pathname: string): { name: string; tail: string } | undefined {
  if (!pathname.startsWith(APPS_PREFIX + "/")) return undefined
  const rest = pathname.slice(APPS_PREFIX.length + 1)
  if (rest === "") return undefined
  const slash = rest.indexOf("/")
  if (slash === -1) return { name: rest, tail: "" }
  return { name: rest.slice(0, slash), tail: rest.slice(slash) }
}

export function serveAppsProxy(
  client: HttpClient.HttpClient,
  request: HttpServerRequest.HttpServerRequest,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, Socket.WebSocketConstructor> {
  return Effect.gen(function* () {
    const url = new URL(request.url, "http://localhost")
    const parsed = parseAppPath(url.pathname)
    if (!parsed) {
      return HttpServerResponse.text("No app specified. Use /apps/<name>/", { status: 404 })
    }

    const { name, tail } = parsed
    const entry = readRegistry()[name]
    if (!entry || typeof entry.port !== "number") {
      return HttpServerResponse.text(`Unknown app: ${name}`, { status: 404 })
    }

    // Serve apps from a trailing slash so the app's relative links and assets
    // resolve under /apps/<name>/ instead of escaping to the opencode root.
    if (tail === "" && !url.pathname.endsWith("/")) {
      return HttpServerResponse.empty({
        status: 307,
        headers: { location: `${APPS_PREFIX}/${name}/${url.search}` },
      })
    }

    const target = new URL(`http://127.0.0.1:${entry.port}`)
    target.pathname = tail === "" ? "/" : tail
    target.search = url.search

    const headers = request.headers as Record<string, string | undefined>
    if (headers["upgrade"]?.toLowerCase() === "websocket") {
      return yield* HttpApiProxy.websocket(request, target.toString())
    }

    // X-Forwarded-Prefix lets prefix-aware frameworks (FastAPI root_path, etc.)
    // emit correct absolute URLs even though we strip the prefix before forwarding.
    return yield* HttpApiProxy.http(client, target, { "x-forwarded-prefix": `${APPS_PREFIX}/${name}` }, request)
  })
}
