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

auto_restore="$(printf '%s' "${OPENCODE_APPS_AUTO_RESTORE:-true}" | tr '[:upper:]' '[:lower:]')"
case "$auto_restore:$1" in
  0:* | false:* | no:* | off:*)
    ;;
  *:web | *:serve)
    /usr/local/bin/apps restore || true
    ;;
esac

exec /usr/local/bin/opencode "$@"
