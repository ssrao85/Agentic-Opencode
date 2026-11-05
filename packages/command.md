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
  -t opencode-local-16 \
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
  opencode-local-16:latest \
  web --hostname 0.0.0.0 --port 3000
```

```
docker build --pull --no-cache \
  -f packages/opencode/Dockerfile \
  -t opencode-local-19 \
  packages/opencode
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
  -e OPENCODE_APPS_AUTO_RESTORE="false" \
  -e OPENCODE_SERVER_MODE="serve" \
  -v /home/pragyan/opencode-test/all-workspaces:/all-workspaces \
  -v /home/pragyan/opencode-test/.local:/.local \
  -v /home/pragyan/opencode-test/.cache:/.cache \
  -v /home/pragyan/opencode-test/.config:/.config \
  opencode-local-20:latest \
  web --hostname 0.0.0.0 --port 3000
```

```


docker run --rm -it \
--add-host=host.docker.internal:host-gateway \
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
  -e OPENCODE_APPS_AUTO_RESTORE="false" \
  -e OPENCODE_SERVER_MODE="serve" \
  -e GLOBAL_SKILLS_DIRETORY_SOURCE="/global-skills" \
  -e GLOBAL_SKILLS_DIRETORY_DESTINATION="/.config/opencode/skills" \
  -e OPENCODE_PRINT_LOGS="1" \
  -e OPENCODE_LOG_LEVEL="DEBUG" \
  -e OPENCODE_CLUSTER_DEBUG="1" \
  -e OPENCODE_SESSION_DEBUG="1" \
  -e OPENCODE_DISABLE_AUTOUPDATE=1 \
  -e OPENCODE_DISABLE_MODELS_FETCH=1 \
  -e OPENCODE_DISABLE_SHARE=1 \
  -e OPENCODE_DISABLE_LSP_DOWNLOAD=1 \
  -e OPENCODE_DISABLE_EXTERNAL_SKILLS=1 \
  -e OPENCODE_DISABLE_DEFAULT_PLUGINS=1 \
  -e OPENCODE_PURE=1 \
  -v /home/pragyan/opencode-test/all-workspaces:/all-workspaces \
  -v /home/pragyan/opencode-test/.local:/.local \
  -v /home/pragyan/opencode-test/.cache:/.cache \
  -v /home/pragyan/opencode-test/.config:/.config \
  -v /home/pragyan/opencode-test/global-skills:/global-skills \
  opencode-local-26:latest \
  web --hostname 0.0.0.0 --port 3000
```

```


docker run --rm -it \
--add-host=host.docker.internal:host-gateway \
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
  -e OPENCODE_APPS_AUTO_RESTORE="false" \
  -e OPENCODE_SERVER_MODE="serve" \
  -e GLOBAL_SKILLS_DIRETORY_SOURCE="/global-skills" \
  -e GLOBAL_SKILLS_DIRETORY_DESTINATION="/.config/opencode/skills" \
  -e OPENCODE_PRINT_LOGS="1" \
  -e OPENCODE_LOG_LEVEL="DEBUG" \
  -e OPENCODE_CLUSTER_DEBUG="1" \
  -e OPENCODE_SESSION_DEBUG="1" \
  -e OPENCODE_DISABLE_AUTOUPDATE=1 \
  -e OPENCODE_DISABLE_MODELS_FETCH=1 \
  -e OPENCODE_DISABLE_SHARE=1 \
  -e OPENCODE_DISABLE_LSP_DOWNLOAD=1 \
  -e OPENCODE_DISABLE_EXTERNAL_SKILLS=1 \
  -e OPENCODE_DISABLE_DEFAULT_PLUGINS=1 \
  -e OPENCODE_PURE=1 \
  -v /home/pragyan/opencode-test/all-workspaces:/all-workspaces \
  -v /home/pragyan/opencode-test/.local:/.local \
  -v /home/pragyan/opencode-test/.cache:/.cache \
  -v /home/pragyan/opencode-test/.config:/.config \
  -v /home/pragyan/opencode-test/global-skills:/global-skills \
  opencode-local-24:latest \
  web --hostname 0.0.0.0 --port 3000
```

```


docker run --rm -it \
--add-host=host.docker.internal:host-gateway \
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
  -e OPENCODE_APPS_AUTO_RESTORE="false" \
  -e OPENCODE_SERVER_MODE="serve" \
  -e GLOBAL_SKILLS_DIRETORY_SOURCE="/global-skills" \
  -e GLOBAL_SKILLS_DIRETORY_DESTINATION="/.config/opencode/skills" \
  -e OPENCODE_PRINT_LOGS="1" \
  -e OPENCODE_LOG_LEVEL="DEBUG" \
  -e OPENCODE_CLUSTER_DEBUG="1" \
  -e OPENCODE_SESSION_DEBUG="1" \
  -e OPENCODE_DISABLE_AUTOUPDATE=1 \
  -e OPENCODE_DISABLE_MODELS_FETCH=1 \
  -e OPENCODE_DISABLE_SHARE=1 \
  -e OPENCODE_DISABLE_LSP_DOWNLOAD=1 \
  -e OPENCODE_DISABLE_EXTERNAL_SKILLS=1 \
  -e OPENCODE_DISABLE_DEFAULT_PLUGINS=1 \
  -e OPENCODE_MAX_FILE_UPLOAD_BYTES=68157440 \
  -e OPENCODE_MAX_IMAGES=5 \
  -e OPENCODE_MAX_IMAGE_BYTES=100MiB \
  -e OPENCODE_PURE=1 \
  -v /home/pragyan/opencode-test/all-workspaces:/all-workspaces \
  -v /home/pragyan/opencode-test/.local:/.local \
  -v /home/pragyan/opencode-test/.cache:/.cache \
  -v /home/pragyan/opencode-test/.config:/.config \
  -v /home/pragyan/opencode-test/global-skills:/global-skills \
  opencode-local-15:latest \
  web --hostname 0.0.0.0 --port 3000

```

```

docker run --rm -it \
--add-host=host.docker.internal:host-gateway \
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
  -e OPENCODE_APPS_AUTO_RESTORE="false" \
  -e OPENCODE_SERVER_MODE="serve" \
  -e GLOBAL_SKILLS_DIRETORY_SOURCE="/global-skills" \
  -e GLOBAL_SKILLS_DIRETORY_DESTINATION="/.config/opencode/skills" \
  -e OPENCODE_PRINT_LOGS="1" \
  -e OPENCODE_LOG_LEVEL="DEBUG" \
  -e OPENCODE_CLUSTER_DEBUG="1" \
  -e OPENCODE_SESSION_DEBUG="1" \
  -e OPENCODE_DISABLE_AUTOUPDATE=1 \
  -e OPENCODE_DISABLE_MODELS_FETCH=1 \
  -e OPENCODE_DISABLE_SHARE=1 \
  -e OPENCODE_MAX_FILE_UPLOAD_BYTES=68157440 \
  -e OPENCODE_MAX_IMAGES=5 \
  -e OPENCODE_MAX_IMAGE_BYTES=100MiB \
  -v /home/pragyan/opencode-test/all-workspaces:/all-workspaces \
  -v /home/pragyan/opencode-test/.local:/.local \
  -v /home/pragyan/opencode-test/.cache:/.cache \
  -v /home/pragyan/opencode-test/.config:/.config \
  -v /home/pragyan/opencode-test/global-skills:/global-skills \
  opencode-local-15:latest \
  web --hostname 0.0.0.0 --port 3000
```

```
docker run --rm -it \
--add-host=host.docker.internal:host-gateway \
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
  -e OPENCODE_APPS_AUTO_RESTORE="false" \
  -e OPENCODE_SERVER_MODE="serve" \
  -e GLOBAL_SKILLS_DIRETORY_SOURCE="/global-skills" \
  -e GLOBAL_SKILLS_DIRETORY_DESTINATION="/.config/opencode/skills" \
  -e OPENCODE_PRINT_LOGS="1" \
  -e OPENCODE_LOG_LEVEL="DEBUG" \
  -e OPENCODE_CLUSTER_DEBUG="1" \
  -e OPENCODE_SESSION_DEBUG="1" \
  -e OPENCODE_DISABLE_AUTOUPDATE=1 \
  -e OPENCODE_DISABLE_MODELS_FETCH=1 \
  -e OPENCODE_DISABLE_SHARE=1 \
  -e OPENCODE_MAX_FILE_UPLOAD_BYTES=68157440 \
  -e OPENCODE_MAX_IMAGES=1 \
  -e OPENCODE_MAX_IMAGE_BYTES=100MiB \
  -v /home/pragyan/opencode-test/all-workspaces:/all-workspaces \
  -v /home/pragyan/opencode-test/.local:/.local \
  -v /home/pragyan/opencode-test/.cache:/.cache \
  -v /home/pragyan/opencode-test/.config:/.config \
  -v /home/pragyan/opencode-test/global-skills:/global-skills \
  opencode-local-15:latest \
  web --hostname 0.0.0.0 --port 3000

```
