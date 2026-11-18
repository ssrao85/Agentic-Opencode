# Running opencode in Docker

How to build this customized opencode into a Docker image, run it locally, and
deploy it to OpenShift. All commands run from the repository root unless noted.

- Container configuration rules: [README.md](./README.md#container-configuration)
- Deployed apps, the `apps` CLI and the Apps panel: [container/README.md](./container/README.md)

## 1. Prerequisites

- **Docker** (Docker Desktop on macOS, Docker Engine on Linux).
- **Bun 1.3.14**, the version pinned in the root `package.json`. Newer Bun
  releases fail to apply the repository's dependency patches. Either install
  1.3.14 or prefix commands with `bunx bun@1.3.14`, as below.
- **macOS only:** if `bun install` fails linking a native module with
  `tapi error: ... unknown architecture`, the newest Command Line Tools SDK is
  not usable by the linker. Point the build at an older SDK for steps 2 and 3:

  ```bash
  export SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk   # any installed SDK that links
  ```

## 2. Install dependencies

```bash
bunx bun@1.3.14 install --frozen-lockfile
```

## 3. Build the opencode binaries

Builds every platform's binary into `packages/opencode/dist/` and embeds the web
UI. Takes about 10 minutes.

```bash
bunx bun@1.3.14 ./packages/opencode/script/build.ts
```

The Dockerfile uses `dist/opencode-linux-x64-baseline-musl` for x86_64 images and
`dist/opencode-linux-arm64-musl` for arm64 images.

## 4. Build the image

```bash
docker build --platform linux/amd64 \
  -f packages/opencode/Dockerfile \
  --build-arg REVISION="$(git rev-parse --short HEAD)" \
  -t opencode-local:latest \
  -t "opencode-local:$(git rev-parse --short HEAD)" \
  packages/opencode
```

- Tag every build with its commit (the second `-t`) and deploy that tag, never
  `latest`. A commit tag is immutable, so you always know what is running and can
  roll back to an exact build. `REVISION` is also stored as the
  `org.opencontainers.image.revision` label
  (`docker inspect -f '{{ index .Config.Labels "org.opencontainers.image.revision" }}' <image>`).

- **Use `--platform linux/amd64`**, the architecture of the OpenShift nodes. On
  Apple Silicon this runs under emulation and takes 30–60 minutes the first time;
  later builds reuse the layer cache.
- **Do not build `linux/arm64` without changes.** `pymupdf` publishes no Alpine
  (musl) wheel for arm64, so it compiles from source and fails with
  `libclang does not appear to be installed`. x86_64 installs a prebuilt wheel.
- If `npm install -g ...` or `uv pip install ...` fails on a network error, run
  the build again.

Check the image:

```bash
docker run --rm --platform linux/amd64 --entrypoint sh opencode-local:latest \
  -c 'opencode --version && apps --help | head -1'
```

## 5. Prepare local folders and the config file

Everything the container keeps lives on the host, so it survives container
re-creation:

```bash
mkdir -p ~/opencode-test/{all-workspaces,.local,.cache,.config/opencode,global-skills}
```

| Host folder | Container path | Holds |
|---|---|---|
| `all-workspaces` | `/all-workspaces` | Projects, the apps registry (`apps.json`) and app logs |
| `.local` | `/.local` | Database and provider credentials (`share/opencode/auth.json`) |
| `.cache` | `/.cache` | Caches |
| `.config` | `/.config` | `opencode/opencode.jsonc` and synced global skills |
| `global-skills` | `/global-skills` | Skills copied into `/.config/opencode/skills` on start |

This build loads **exactly one** config file, chosen by `OPENCODE_CONFIG_ONLY`
(default `/etc/opencode/opencode.jsonc`). It must exist and be non-empty, or
opencode refuses to start. Create `~/opencode-test/.config/opencode/opencode.jsonc`,
for example with a free OpenRouter model:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
  "small_model": "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
  "provider": {
    "openrouter": {
      "npm": "@openrouter/ai-sdk-provider",
      "models": {
        "nvidia/nemotron-3-ultra-550b-a55b:free": {
          "name": "Nemotron 3 Ultra (free)",
          "reasoning": true,
          "tool_call": true,
          "limit": { "context": 262144, "output": 32768 }
        }
      }
    }
  }
}
```

## 6. Run the container

```bash
docker run -d --name opencode --restart unless-stopped --platform linux/amd64 \
  --add-host=host.docker.internal:host-gateway \
  --user 1001:0 \
  -p 127.0.0.1:3000:3000 \
  -e OPENCODE_CONFIG_ONLY="/.config/opencode/opencode.jsonc" \
  -e OPENCODE_SERVER_PASSWORD="change-me" \
  -e OPENCODE_DB="opencode.db" \
  -e OPENCODE_APPS_BASE_URL="http://localhost:3000" \
  -e OPENCODE_WORKSPACE_ROOT="/all-workspaces" \
  -e OPENCODE_APPS_AUTO_RESTORE="false" \
  -e OPENCODE_SERVER_MODE="serve" \
  -e GLOBAL_SKILLS_DIRETORY_SOURCE="/global-skills" \
  -e GLOBAL_SKILLS_DIRETORY_DESTINATION="/.config/opencode/skills" \
  -e STORAGE_REFRESH_INTERVAL_MS="60000" \
  -e STORAGE_STAT_TIMEOUT_MS="5000" \
  -e STORAGE_WARNING_PERCENT="20" \
  -e STORAGE_CRITICAL_PERCENT="10" \
  -e OPENCODE_DISABLE_AUTOUPDATE=1 \
  -e OPENCODE_DISABLE_MODELS_FETCH=1 \
  -e OPENCODE_DISABLE_SHARE=1 \
  -e OPENCODE_DISABLE_LSP_DOWNLOAD=1 \
  -e OPENCODE_DISABLE_EXTERNAL_SKILLS=1 \
  -e OPENCODE_DISABLE_DEFAULT_PLUGINS=1 \
  -e OPENCODE_PURE=1 \
  -v ~/opencode-test/all-workspaces:/all-workspaces \
  -v ~/opencode-test/.local:/.local \
  -v ~/opencode-test/.cache:/.cache \
  -v ~/opencode-test/.config:/.config \
  -v ~/opencode-test/global-skills:/global-skills \
  opencode-local:latest \
  web --hostname 0.0.0.0 --port 3000
```

- `--restart unless-stopped` brings the container back after a crash, a Docker
  restart or a reboot (Docker Desktop must start at login).
- `-p 127.0.0.1:3000:3000` exposes opencode to this machine only.
- **Password:** log in with user `opencode` and `OPENCODE_SERVER_PASSWORD`. To
  run without a password, drop that line; keep the `127.0.0.1` binding then, and
  the server logs `server is unsecured`. VS Code's Simple Browser cannot show the
  login prompt, so use a normal browser when a password is set.
- `OPENCODE_APPS_AUTO_RESTORE=false` means apps are **not** relaunched on
  container start. The auto-restart watchdog (`apps supervise`) still runs.
- Optional debug logging: add `-e OPENCODE_PRINT_LOGS=1 -e OPENCODE_LOG_LEVEL=DEBUG`.

## 7. Add model credentials

Free OpenCode Zen models (`opencode/*-free`) can return `Free usage limit
reached` for custom builds; use a provider key instead. Either log in
interactively:

```bash
docker exec -it opencode opencode auth login
```

or write `~/opencode-test/.local/share/opencode/auth.json` (keep it `chmod 600`):

```json
{
  "openrouter": { "type": "api", "key": "<your OpenRouter key>" }
}
```

Then `docker restart opencode`.

## 8. Verify

```bash
docker ps --filter name=opencode                         # Up
docker logs opencode 2>&1 | grep -E "loading exclusive config|supervising|restored|ERROR"
docker exec opencode apps list                           # your apps and their status
curl -s -u opencode:change-me -o /dev/null -w '%{http_code}\n' http://localhost:3000/   # 200
```

Then open http://localhost:3000, log in, open a project and send a message.
**Deployed Apps** sits above Settings in the sidebar. It opens the **Apps** tab in
the session's right panel, next to Review, where you can open, start, stop and
remove apps without leaving the chat.

## 9. Day-to-day commands

```bash
docker exec -it opencode bash             # shell inside the container (-u 0 for root)
docker logs -f opencode                   # follow logs
docker restart opencode                   # restart
docker stop opencode / docker start opencode
docker exec opencode apps restore         # relaunch registered apps after a restart
docker rm -f opencode                     # remove the container; data in ~/opencode-test is kept
```

**Upgrading to a new image:** rebuild (steps 3–4), then `docker rm -f opencode`
and run step 6 again with the new tag.

## 10. Deploy to OpenShift

1. Build the image as in step 4, tagged for the registry:
   `-t <registry>/<project>/opencode:<version>`.
2. Push it:

   ```bash
   docker login <registry>
   docker push <registry>/<project>/opencode:<version>
   ```

3. Make sure the deployment sets `OPENCODE_CONFIG_ONLY` to a mounted, non-empty
   config file (for example from a ConfigMap), or mounts one at
   `/etc/opencode/opencode.jsonc`.
4. Roll out:

   ```bash
   oc set image deployment/<opencode-deployment> <container>=<registry>/<project>/opencode:<version>
   oc rollout status deployment/<opencode-deployment>
   ```

5. Verify:

   ```bash
   oc logs deployment/<opencode-deployment> | grep -E "loading exclusive config|supervising"
   oc exec deploy/<opencode-deployment> -- apps list
   ```

6. Roll back if needed: `oc rollout undo deployment/<opencode-deployment>`.

Run a single replica with `strategy: Recreate`: deployed apps are processes inside
the opencode pod and the registry on `/all-workspaces` is per pod. A rolling update
would briefly run two pods against the same registry (and a ReadWriteOnce volume
can block the new pod).

```bash
oc patch deployment/<opencode-deployment> -p '{"spec":{"replicas":1,"strategy":{"type":"Recreate","rollingUpdate":null}}}'
```

The Apps panel is built into opencode; there is no separate dashboard
process any more. If you used the no-image Python dashboard copy on the volume
before, remove it after the rollout (and any `command`/`args` override added for it):
`oc exec deploy/<opencode-deployment> -- rm -rf /all-workspaces/.opencode/dashboard /all-workspaces/deployed-apps-dashboard`.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `bun install` fails applying patches | Wrong Bun version; use `bunx bun@1.3.14`. |
| `tapi error ... unknown architecture` (macOS) | Set `SDKROOT` to an older SDK (step 1). |
| `lockfile had changes, but lockfile is frozen` | `bun.lock` is out of date; run `bun install` without `--frozen-lockfile` and commit the lockfile. |
| arm64 build fails on `pymupdf` / `libclang` | Build `--platform linux/amd64` (step 4). |
| Logs show `Required configuration file does not exist` | `OPENCODE_CONFIG_ONLY` points to a missing or empty file (step 5). |
| Chat reply stays empty | Check `docker logs opencode 2>&1 \| grep ERROR`; usually a provider key or quota problem (step 7). |
| `EACCES: permission denied, mkdir '/.npm'` warnings | Older images only: the image now sets `NPM_CONFIG_CACHE=/tmp/.npm`. For an older image, add `-e NPM_CONFIG_CACHE=/tmp/.npm`. |
| Apps panel shows `apps CLI failed` | opencode cannot run the `apps` CLI. It ships in the image at `/usr/local/bin/apps`; set `OPENCODE_APPS_CLI` if it lives elsewhere. |
| A crashed app still shows Running | The container is not running tini as PID 1 (for example the entrypoint was overridden). Keep `ENTRYPOINT ["/sbin/tini", "--", "opencode-entrypoint"]`. |
