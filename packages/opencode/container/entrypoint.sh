#!/bin/sh
# Container entrypoint.
#
# When starting the opencode web server, first relaunch any apps that were
# deployed via `apps run` and recorded in the persistent registry but aren't
# currently running — i.e. bring deployed apps back up after a pod restart.
# Then exec opencode so it remains PID 1 and receives signals directly.
case "$1" in
  web | serve)
    /usr/local/bin/apps restore || true
    ;;
esac

exec /usr/local/bin/opencode "$@"
