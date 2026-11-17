#!/bin/sh
# Container entrypoint.
#
# When starting selected opencode server modes, first relaunch any apps that
# were deployed via `apps run` and recorded in the persistent registry but
# aren't currently running — i.e. bring deployed apps back up after a pod restart.
# Then exec opencode so it remains PID 1 and receives signals directly.
server_mode="${OPENCODE_SERVER_MODE:-web}"

case "${1:-}" in
  "")
    set -- "$server_mode"
    ;;
  --hostname | --port | --print-logs)
    set -- "$server_mode" "$@"
    ;;
esac

global_skills_source="${GLOBAL_SKILLS_DIRETORY_SOURCE:-}"
global_skills_destination="${GLOBAL_SKILLS_DIRETORY_DESTINATION:-}"

if [ -n "$global_skills_source" ] || [ -n "$global_skills_destination" ]; then
  if [ -z "$global_skills_source" ] || [ -z "$global_skills_destination" ]; then
    echo "GLOBAL_SKILLS_DIRETORY_SOURCE and GLOBAL_SKILLS_DIRETORY_DESTINATION must both be set to sync global skills." >&2
    exit 1
  fi

  if [ ! -d "$global_skills_source" ]; then
    echo "GLOBAL_SKILLS_DIRETORY_SOURCE is not a directory: $global_skills_source" >&2
    exit 1
  fi

  mkdir -p "$global_skills_destination"
  cp -R "$global_skills_source"/. "$global_skills_destination"/.
fi

# Forget pids recorded by the previous container before anything reads them; see
# `apps reset-pids`. Only server modes own the registry, so one-off CLI runs that
# share the volume never touch a live server's entries.
case "${1:-}" in
  web | serve)
    /usr/local/bin/apps reset-pids || true
    # Older images ran a Python dashboard as the `dashboard` app; the Deployed Apps
    # page is now built into opencode, so drop that entry once.
    if grep -q '"/opt/opencode-dashboard"' "${OPENCODE_APPS_REGISTRY:-/all-workspaces/apps.json}" 2>/dev/null; then
      /usr/local/bin/apps rm dashboard || true
    fi
    ;;
esac

auto_restore="$(printf '%s' "${OPENCODE_APPS_AUTO_RESTORE:-true}" | tr '[:upper:]' '[:lower:]')"
case "$auto_restore:$1" in
  0:* | false:* | no:* | off:*)
    ;;
  *:web | *:serve)
    /usr/local/bin/apps restore || true
    ;;
esac

# Watchdog for apps with auto-restart on (toggled on the Deployed Apps page). It runs
# for the life of the container, independent of OPENCODE_APPS_AUTO_RESTORE.
case "${1:-}" in
  web | serve)
    /usr/local/bin/apps supervise &
    ;;
esac

exec /usr/local/bin/opencode "$@"
