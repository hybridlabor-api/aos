from __future__ import annotations

import re
from typing import Any

from fastapi import FastAPI, HTTPException

NAME_RE = re.compile(r"^[a-z0-9-]{3,32}$")

mock_app = FastAPI(title="BDB RemoteOS Mock Incus Backend")

MOCK_INSTANCES: dict[str, dict[str, Any]] = {}
MOCK_SNAPSHOTS: dict[str, list[str]] = {}


@mock_app.get("/1.0/instances")
def list_instances() -> dict[str, Any]:
    return {"status": "success", "status_code": 200, "metadata": list(MOCK_INSTANCES.values())}


@mock_app.post("/1.0/instances")
def create_instance(payload: dict) -> dict[str, Any]:
    name = payload.get("name", "")
    if not NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="Invalid container name or command injection detected")
    if name in MOCK_INSTANCES:
        raise HTTPException(status_code=409, detail="Instance already exists")
    MOCK_INSTANCES[name] = {
        "name": name,
        "status": "Running",
        "profiles": payload.get("profiles", []),
    }
    return {"status": "success", "status_code": 200, "metadata": MOCK_INSTANCES[name]}


@mock_app.put("/1.0/instances/{name}/state")
def set_state(name: str, payload: dict) -> dict[str, Any]:
    if name not in MOCK_INSTANCES:
        raise HTTPException(status_code=404, detail="Instance not found")
    action = payload.get("action")
    if action == "delete":
        raise HTTPException(status_code=400, detail="Use DELETE /1.0/instances/{name}")
    MOCK_INSTANCES[name]["status"] = "Running" if action == "start" else "Stopped"
    return {"status": "success", "status_code": 200, "metadata": {"action": action}}


@mock_app.post("/1.0/instances/{name}/snapshots")
def create_snapshot(name: str, payload: dict) -> dict[str, Any]:
    if name not in MOCK_INSTANCES:
        raise HTTPException(status_code=404, detail="Instance not found")
    MOCK_SNAPSHOTS.setdefault(name, []).append(payload.get("name", "snap"))
    return {"status": "success", "status_code": 200, "metadata": {}}


@mock_app.delete("/1.0/instances/{name}")
def delete_instance(name: str) -> dict[str, Any]:
    if name not in MOCK_INSTANCES:
        raise HTTPException(status_code=404, detail="Instance not found")
    del MOCK_INSTANCES[name]
    return {"status": "success", "status_code": 200, "metadata": {}}
