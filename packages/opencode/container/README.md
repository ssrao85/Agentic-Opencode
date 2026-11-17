# Exposing user apps under `/apps/<name>/`

opencode is the only port the OpenShift Route exposes (3000). Apps you build inside
the pod (a FastAPI on :5000, a Vite dev server on :5173, …) bind to loopback and are
otherwise unreachable from outside. opencode multiplexes them onto its own port:

```
GET /apps/<name>/...  →  127.0.0.1:<port>/...   (prefix stripped)
```

- **Same auth**: `/apps/*` sits behind opencode's existing Basic-auth gate — no second login.
- **WebSockets**: upgrades are proxied (HMR, websockets, etc.).
- **Prefix header**: every proxied request carries `X-Forwarded-Prefix: /apps/<name>`.

Implementation: [`apps-proxy.ts`](../src/server/routes/instance/httpapi/apps-proxy.ts),
wired in [`server.ts`](../src/server/routes/instance/httpapi/server.ts).

## The one rule: make the app prefix-aware

An app written for `/` breaks when served under `/apps/<name>/` (absolute links,
redirects, asset paths). Start each app told about its prefix:

| Framework | Flag |
|---|---|
| FastAPI / uvicorn | `--root-path /apps/<name>` |
| Flask / gunicorn  | `SCRIPT_NAME=/apps/<name>` |
| Vite              | `base: '/apps/<name>/'` |
| Next.js           | `basePath: '/apps/<name>'` |
| Streamlit         | `--server.baseUrlPath=/apps/<name>` |

Apps must bind **127.0.0.1** (not 0.0.0.0) so they're reachable only through opencode.

## The `apps` CLI

Maintains the name→port registry (`$OPENCODE_APPS_REGISTRY`, default
`/all-workspaces/apps.json`) that opencode reads per request, and launches apps
detached so they stay up until killed.

```sh
# one-command auto-deploy: detect framework, make prefix-aware, launch, register
cd /all-workspaces/<id> && apps deploy api     # → /apps/api/

# manual launch + register — port auto-allocated; use {port} in the command
apps run api -- uvicorn main:app --host 127.0.0.1 --port {port} --root-path /apps/api
# → reachable at /apps/api/   (and /apps/api/docs)

apps add web 5173     # register an already-running app (explicit port)
apps list             # show registered apps + live status
apps stop api         # stop it and keep it stopped across restarts
apps start api        # relaunch it with its recorded command and port
apps set api auto-restart on   # relaunch it whenever it exits on its own
apps kill api         # stop the process group and unregister
apps restore          # relaunch registered apps that aren't running (e.g. after a pod restart)
```

`apps run` **auto-allocates a free port** (8000–8999), substitutes `{port}` in the
command, and exports it as `$PORT` and `OPENCODE_APP_PREFIX=/apps/<name>`. Deploying
a new app never collides with or kills a running one — each gets its own port.
Re-running with the same `<name>` replaces just that app. You may still pass an
explicit port (`apps run <name> <port> -- …`) to request a specific one.

## Pod restarts

Detached apps stay up for the life of the pod. The registry (and each app's
command + working dir) persists on the `/all-workspaces` volume, so the
container entrypoint (`container/entrypoint.sh`) runs **`apps restore`**
automatically when opencode starts in `web` or `serve` mode — deployed apps come
back up after a pod restart with no manual step. You can also run `apps restore`
by hand. Apps stopped with `apps stop` (or **Stop** in the UI) stay stopped.

Before restoring, the entrypoint runs `apps reset-pids`. Recorded pids belong to
the previous container and may now be reused by an unrelated process, so they are
cleared rather than trusted. Set `OPENCODE_APPS_AUTO_RESTORE=false` to disable this. The container
starts `OPENCODE_SERVER_MODE=web` by default; set it to `serve` to start that
mode instead.

## Deployed Apps page

Building and running the image: [DOCKER.md](../DOCKER.md).

The web UI's **Deployed Apps** sidebar entry (`/deployed-apps`) is built into
opencode. It lists every registered app with its status, framework, port and deploy
time, and can Open / Start / Stop / Remove apps and toggle **Auto-restart**.

- The page calls opencode's `/deployed-app` API (`deployedApp.*` in the SDK).
  opencode reads the registry for the list and runs the `apps` CLI for every
  action, so launching and stopping apps has a single implementation.
- Registry fields beyond the CLI's launch data: `deployedAt`, `autoRestart`, and
  `stopped` (set by `apps stop` so the app is not relaunched). `apps run`/`apps deploy`
  keep these fields, stamp `deployedAt` with the deploy time and clear `stopped`;
  `apps restore` and `apps start` keep the original `deployedAt`. Apps registered
  with `apps add` show an unknown deploy time.
- **Auto-restart** is `apps supervise`, a watchdog the entrypoint starts for the life
  of the container: every 10 seconds it relaunches apps with auto-restart on that
  exited without `apps stop`.
- **Remove** stops the app and unregisters it; its files are kept.
- The image runs `tini` as PID 1. Apps are detached and re-parented to PID 1 when
  the command that launched them exits; tini reaps them when they exit, so a
  crashed app shows as stopped instead of lingering as a zombie.
- Images before this page ran a Python dashboard as the `dashboard` app; the
  entrypoint removes that registry entry on first start.
