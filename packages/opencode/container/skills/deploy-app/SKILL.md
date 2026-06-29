---
name: deploy-app
description: Deploy, run, start, launch, serve, preview, open, host, publish, or expose an app the user built so it is reachable under /apps/<name>/. Use WHENEVER the user wants to run, start, deploy, preview, or see a web app or server they made — FastAPI/Flask/Django, Vite/React, Next.js, Streamlit, Gradio, or plain Node/static. opencode is the only port the platform exposes; it reverse-proxies /apps/<name>/* to the app, so an app must be launched via the `apps` CLI to be reachable. Starting a server directly does NOT expose it and the port is unreachable.
---

# Deploy an app under /apps/<name>/

> **THE ONE RULE — read first.** Expose an app **only** by registering it with the
> `apps` CLI: `apps deploy <name>` (automatic) or `apps run <name> -- <cmd>` (manual).
> That both starts the process **and** registers it so opencode proxies it. If you
> start the server any other way — `uvicorn …`, `npm run dev`, `python -m http.server`,
> a trailing `&`, `nohup` — the app is **NOT** exposed: `/apps/<name>/` returns
> **"unknown app"** and the port is unreachable. **Never start a web server yourself.**

The platform (OpenShift) exposes **only opencode's port**. opencode reverse-proxies
`/apps/<name>/*` to a loopback app in the same container. There is no separate
hosting step and no OpenShift change — deploying is always "register it with `apps`."

## Quickest path — `apps deploy`

From the app's directory, run **one** command:

```sh
cd <app-dir>          # where the app's files live, e.g. /all-workspaces/<id>
apps deploy <name>    # <name> is the URL segment: /apps/<name>/
```

`apps deploy` auto-detects the app, makes it prefix-aware for `/apps/<name>`,
launches it on a free port, registers it, and prints the URL. For FastAPI it runs
`uvicorn <module>:<app> --host 127.0.0.1 --port <free> --root-path /apps/<name>` for
you, preferring `<name>.py` (so multiple apps in one folder deploy by name, e.g.
`apps deploy division` → `division.py`). Then jump to step 5 (verify) and 6 (URL).

If `apps deploy` can't auto-detect your app, it prints the exact `apps run` command —
use the manual steps below.

## Manual deploy — `apps run` (custom apps)

1. **Identify** the app: framework, entrypoint (e.g. `main.py`, `app.py`,
   `package.json` script), and the port it listens on. Look in the app's folder
   (vibe-coded apps live under `/all-workspaces/<id>/`).

2. **Choose a short slug** `<name>` (kebab-case, e.g. `sum-calc`). This is the
   public path `/apps/<name>/`. Keep it stable — changing it changes the URL.

3. **Make the app prefix-aware** for `/apps/<name>` and bind it to **127.0.0.1**
   (never 0.0.0.0). An app written for `/` breaks under a sub-path unless told its
   prefix:

   | Framework | How to set the prefix |
   | --- | --- |
   | FastAPI / uvicorn | `--root-path /apps/<name>` |
   | Flask / gunicorn | env `SCRIPT_NAME=/apps/<name>` (or `ProxyFix`) |
   | Streamlit | `--server.baseUrlPath /apps/<name>` |
   | Gradio | `demo.launch(root_path="/apps/<name>")` |
   | Vite | `base: '/apps/<name>/'` in `vite.config` |
   | Next.js | `basePath: '/apps/<name>'` in `next.config` |
   | Plain Node / Express | mount the router at `/apps/<name>`, or read `X-Forwarded-Prefix` |

   In server-rendered HTML, make form `action`s, links, and `fetch()` URLs
   **relative** (`./sum`, not `/sum`) — or build them from the framework's
   root_path. opencode always forwards `X-Forwarded-Prefix: /apps/<name>`, so
   prefix-aware frameworks emit correct absolute URLs automatically.

4. **Deploy** with the `apps` CLI. **Do not stop or kill other running apps to
   free a port** — `apps run` auto-allocates a free port, so a new app never
   collides with one that's already up. Omit the port and write **`{port}`** where
   the app needs its port; the CLI substitutes the chosen port (and also exports it
   as `$PORT`). It launches the process detached (stays up until killed) and
   registers it so opencode proxies it immediately, with no opencode restart:

   ```sh
   cd <app-dir>
   apps run <name> -- <command that binds 127.0.0.1:{port} with the prefix>
   ```

   Example — the FastAPI sum calculator from `/all-workspaces/<id>/main.py`:
   ```sh
   cd /all-workspaces/<id>
   apps run sum-calc -- uvicorn main:app --host 127.0.0.1 --port {port} --root-path /apps/sum-calc
   ```

   Each app gets its own port and runs alongside the others. Re-running `apps run`
   with the **same `<name>`** replaces just that one app (it stops its previous
   instance); other apps are never touched. Use a new `<name>` to run another app
   in parallel.

5. **Verify** from inside the container:
   ```sh
   apps list
   curl -s -u opencode:"$OPENCODE_SERVER_PASSWORD" http://127.0.0.1:3000/apps/<name>/ | head
   ```
   Expect the app's own response. Troubleshoot:
   - **"unknown app"** → it is not in the registry. You started the server without
     `apps run`. Stop that stray process and relaunch it via `apps run <name> -- …`.
   - **opencode UI** instead of the app → wrong name/port; check `apps list`.
   - app errors → read `/all-workspaces/apps-logs/<name>.log`.

6. **Give the user the complete URL as a clickable link that opens in a new tab.**
   opencode opens links with `window.open(url, "_blank")`, so a **Markdown link**
   opens the app in a new browser tab.

   - The `apps run` output prints the URL on its `open:` line — reuse that exact
     value. It is absolute (`https://<host>/apps/<name>/`) when the deployment
     sets `OPENCODE_APPS_BASE_URL` to opencode's public origin, otherwise it is the
     root-relative `/apps/<name>/` (which the browser resolves to opencode's
     current origin and still opens the full URL in a new tab).
   - Present it as a Markdown link whose **text is the URL itself**, so the user
     sees and can click the complete address. End your reply with a line like:

     > ✅ Deployed. Open in a new tab: **[https://&lt;host&gt;/apps/sum-calc/](https://&lt;host&gt;/apps/sum-calc/)**

   - Note that links inside the app must stay relative / prefix-aware so
     navigation remains under `/apps/<name>/`.

## Managing deployed apps

```sh
apps list            # registered apps + live status (up / dead / registered)
apps kill <name>     # stop the app's process group and unregister it
apps rm <name>       # unregister without killing the process
apps restore         # relaunch registered apps that aren't running (after a restart)
```

## Notes

- Registry: `/all-workspaces/apps.json`. Logs: `/all-workspaces/apps-logs/<name>.log`.
  Both live on the persistent volume, so registrations survive across sessions.
- Bind apps to **127.0.0.1** only — they must be reachable solely through opencode,
  never on another interface.
- After a **pod restart** the container automatically runs `apps restore` on
  startup, so deployed apps come back up on their own; you can also run it
  manually.
- Multiple apps coexist — give each a distinct `<name>` and free port.
