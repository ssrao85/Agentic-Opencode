```
docker run --rm -it \
  -p 4033:4033 \
  -e OPENCODE_SERVER_PASSWORD="change-me" \
  -v /all-workspaces:/all-workspaces \
  opencode-local web --hostname 0.0.0.0 --port 4033
```

```

docker run --rm -it \
--user 1001:0 \
  -p 4033:4033 \
  -e OPENCODE_SERVER_PASSWORD="change-me" \
  -v /all-workspaces:/all-workspaces \
  opencode-local web --hostname 0.0.0.0 --port 4033
```

```


bun install
./packages/opencode/script/build.ts

docker build \
  -f packages/opencode/Dockerfile \
  -t opencode-local-14 \
  packages/opencode
```

```
docker run --rm -it \
  -p 4033:4033 \
  -e OPENCODE_SERVER_PASSWORD="change-me" \
  -v /all-workspaces:/all-workspaces \
  opencode-local web --hostname 0.0.0.0 --port 4033
```

```
docker run --rm -it --user 1001:0   -p 3000:3000 -e OPENCODE_DB="opencode-feature-Auto-worksapce-path.db" -e OPENCODE_SERVER_PASSWORD="change-me" -e OPENCODE_APPS_BASE_URL="http://localhost:3000" -v /home/pragyan/opencode-test/all-workspaces:/all-workspaces -v  /home/pragyan/opencode-test/.local:/.local -v /home/pragyan/opencode-test/.cache:/.cache -v  /home/pragyan/opencode-test/.config:/.config opencode-local-15:latest web --hostname 0.0.0.0 --port 3000
```


```
docker run --rm -it \
  --user 1001:0 \
  -p 3000:3000 \
  -e OPENCODE_DB="opencode-feature-Auto-worksapce-path.db" \
  -e OPENCODE_SERVER_PASSWORD="change-me" \
  -e OPENCODE_APPS_BASE_URL="http://localhost:3000" \
  -e OPENCODE_WORKSPACE_ROOT="/all-workspaces" \
  -e STORAGE_REFRESH_INTERVAL_MS="60000" \
  -e STORAGE_STAT_TIMEOUT_MS="5000" \
  -e STORAGE_WARNING_PERCENT="20" \
  -e STORAGE_CRITICAL_PERCENT="10" \
  --mount type=tmpfs,destination=/all-workspaces,tmpfs-size=10m,tmpfs-mode=0770 \
  -v /home/pragyan/opencode-test/.local:/.local \
  -v /home/pragyan/opencode-test/.cache:/.cache \
  -v /home/pragyan/opencode-test/.config:/.config \
  opencode-local-15:latest \
  web --hostname 0.0.0.0 --port 3000

```