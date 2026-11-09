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

auto_restore="$(printf '%s' "${OPENCODE_APPS_AUTO_RESTORE:-true}" | tr '[:upper:]' '[:lower:]')"
case "$auto_restore:$1" in
  0:* | false:* | no:* | off:*)
    ;;
  *:web | *:serve)
    /usr/local/bin/apps restore || true
    ;;
esac

# Start the Deployed Apps dashboard (served at /apps/dashboard/, linked from the
# sidebar). It always starts, independent of OPENCODE_APPS_AUTO_RESTORE, so the
# sidebar link works after every container restart. Set OPENCODE_APPS_DASHBOARD=false
# to skip it.
dashboard="$(printf '%s' "${OPENCODE_APPS_DASHBOARD:-true}" | tr '[:upper:]' '[:lower:]')"
case "$dashboard:$1" in
  0:* | false:* | no:* | off:*)
    ;;
  *:web | *:serve)
    (cd /opt/opencode-dashboard && /usr/local/bin/apps run dashboard -- \
      /opt/venv/bin/uvicorn main:app --host 127.0.0.1 --port {port} --root-path /apps/dashboard) || true
    ;;
esac

exec /usr/local/bin/opencode "$@"
