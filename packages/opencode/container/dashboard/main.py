"""Deployed Apps dashboard.

Runs as an ordinary deployed app (served by opencode at /apps/dashboard/) and
manages the other apps in the shared `apps` registry. It does not change
opencode itself: it reads and writes the same registry file that the `apps`
CLI and opencode's /apps/<name>/ proxy use.

Registry entry fields written by the `apps` CLI: port, pid, cmd, cwd, log.
Fields added by this dashboard: deployedAt, autoRestart, stopped.
"""

import json
import os
import re
import signal
import socket
import subprocess
import threading
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

REGISTRY = Path(os.environ.get("OPENCODE_APPS_REGISTRY", "/all-workspaces/apps.json"))
LOG_DIR = Path(os.environ.get("OPENCODE_APPS_LOG_DIR", "/all-workspaces/apps-logs"))
SELF = os.environ.get("DASHBOARD_NAME", "dashboard")
WATCHDOG_SECONDS = 10

app = FastAPI(title="Deployed Apps")
lock = threading.Lock()
# Children started here must be reaped, otherwise they linger as zombies that look alive.
children: dict[int, subprocess.Popen] = {}


def read_registry() -> dict:
    try:
        data = json.loads(REGISTRY.read_text())
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def write_registry(registry: dict) -> None:
    REGISTRY.parent.mkdir(parents=True, exist_ok=True)
    tmp = REGISTRY.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(registry, indent=2))
    tmp.replace(REGISTRY)  # atomic swap, same as the CLI, so readers never see half a file


def update_entry(name: str, **fields) -> dict:
    # Re-read right before writing so a concurrent CLI change to another app is kept.
    registry = read_registry()
    if name not in registry:
        raise HTTPException(404, f"no such app: {name}")
    entry = {**registry[name], **fields}
    registry[name] = {k: v for k, v in entry.items() if v is not None}
    write_registry(registry)
    return registry[name]


def alive(pid) -> bool:
    if not pid:
        return False
    child = children.get(pid)
    if child is not None and child.poll() is not None:
        children.pop(pid, None)
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    # Apps launched by the CLI are orphaned to PID 1, which may never reap them.
    try:
        return Path(f"/proc/{pid}/stat").read_text().split(")")[-1].split()[0] != "Z"
    except OSError:
        return True


def port_free(port: int) -> bool:
    with socket.socket() as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def infer_framework(entry: dict):
    if entry.get("framework"):
        return str(entry["framework"]).lower()
    cmd = " ".join(entry.get("cmd") or []).lower()
    patterns = [
        ("streamlit", r"streamlit"),
        ("fastapi", r"uvicorn|fastapi|hypercorn"),
        ("flask", r"gunicorn|flask"),
        ("vite", r"vite"),
        ("next", r"\bnext\b"),
        ("static", r"http\.server"),
        ("node", r"\b(npm|node|bun|pnpm|yarn)\b"),
    ]
    return next((name for name, pattern in patterns if re.search(pattern, cmd)), None)


def to_info(name: str, entry: dict) -> dict:
    return {
        "name": name,
        "path": f"/apps/{name}/",
        "port": entry.get("port"),
        "status": "running" if alive(entry.get("pid")) else "stopped",
        "framework": infer_framework(entry),
        "deployedAt": entry.get("deployedAt"),
        "autoRestart": bool(entry.get("autoRestart", False)),
        "startable": bool(entry.get("cmd")),
    }


def launch(name: str) -> dict:
    entry = read_registry().get(name)
    if entry is None:
        raise HTTPException(404, f"no such app: {name}")
    if alive(entry.get("pid")):
        return update_entry(name, stopped=None)
    cmd = entry.get("cmd")
    if not cmd:
        raise HTTPException(409, f"{name} has no recorded start command; redeploy it with `apps run`")
    # The CLI bakes the port into the recorded command, so the app can only come back on it.
    if not port_free(entry["port"]):
        raise HTTPException(409, f"port {entry['port']} is already in use")
    log = Path(entry.get("log") or LOG_DIR / f"{name}.log")
    log.parent.mkdir(parents=True, exist_ok=True)
    cwd = entry.get("cwd") if entry.get("cwd") and Path(entry["cwd"]).is_dir() else None
    with open(log, "a") as out:
        child = subprocess.Popen(
            cmd,
            cwd=cwd,
            stdin=subprocess.DEVNULL,
            stdout=out,
            stderr=subprocess.STDOUT,
            start_new_session=True,  # own process group, so stop() also kills its workers
            env={**os.environ, "PORT": str(entry["port"]), "OPENCODE_APP_PREFIX": f"/apps/{name}"},
        )
    children[child.pid] = child
    return update_entry(name, pid=child.pid, log=str(log), stopped=None)


def kill(pid) -> None:
    if not alive(pid):
        return
    for target in (lambda: os.killpg(pid, signal.SIGTERM), lambda: os.kill(pid, signal.SIGTERM)):
        try:
            target()
        except OSError:
            pass


def stamp_new_apps() -> None:
    # The CLI does not record when an app was deployed; use the first time it is seen here.
    registry = read_registry()
    missing = [name for name, entry in registry.items() if isinstance(entry, dict) and "deployedAt" not in entry]
    if not missing:
        return
    now = int(time.time() * 1000)
    for name in missing:
        registry[name]["deployedAt"] = now
    write_registry(registry)


def watchdog() -> None:
    while True:
        time.sleep(WATCHDOG_SECONDS)
        with lock:
            stamp_new_apps()
            for name, entry in read_registry().items():
                if name == SELF or not entry.get("autoRestart") or entry.get("stopped"):
                    continue
                if entry.get("cmd") and not alive(entry.get("pid")):
                    try:
                        launch(name)
                    except HTTPException:
                        pass  # e.g. port busy; try again on the next tick


threading.Thread(target=watchdog, daemon=True).start()


class Settings(BaseModel):
    autoRestart: bool


@app.get("/")
def index():
    return FileResponse(Path(__file__).with_name("index.html"))


@app.get("/api/apps")
def list_apps():
    with lock:
        stamp_new_apps()
        registry = read_registry()
    apps = [
        to_info(name, entry)
        for name, entry in registry.items()
        if name != SELF and isinstance(entry, dict) and isinstance(entry.get("port"), int)
    ]
    return sorted(apps, key=lambda a: (-(a["deployedAt"] or 0), a["name"]))


@app.post("/api/apps/{name}/start")
def start_app(name: str):
    with lock:
        return to_info(name, launch(name))


@app.post("/api/apps/{name}/stop")
def stop_app(name: str):
    with lock:
        entry = read_registry().get(name)
        if entry is None:
            raise HTTPException(404, f"no such app: {name}")
        kill(entry.get("pid"))
        # `stopped` keeps the watchdog from relaunching an app the user stopped on purpose.
        return to_info(name, update_entry(name, pid=None, stopped=True))


@app.patch("/api/apps/{name}")
def update_app(name: str, settings: Settings):
    with lock:
        return to_info(name, update_entry(name, autoRestart=settings.autoRestart))


@app.delete("/api/apps/{name}")
def remove_app(name: str):
    if name == SELF:
        raise HTTPException(409, "the dashboard cannot remove itself")
    with lock:
        registry = read_registry()
        if name not in registry:
            raise HTTPException(404, f"no such app: {name}")
        kill(registry[name].get("pid"))
        del registry[name]
        write_registry(registry)
    return {"removed": name}
