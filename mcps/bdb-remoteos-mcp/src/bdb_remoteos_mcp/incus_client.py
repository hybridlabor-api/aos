from __future__ import annotations

import time
from typing import Any

import httpx


class IncusError(RuntimeError):
    pass


class IncusClient:
    """Thin sync client for the local Incus unix-socket REST API.

    Incus operations are asynchronous: POST/PUT return 202 with an operation
    URL that must be waited on before the result is guaranteed.
    """

    def __init__(self, socket_path: str = "/var/lib/incus/unix.socket", timeout: float = 30.0) -> None:
        self.socket_path = socket_path
        self.timeout = timeout
        try:
            self.transport = httpx.HTTPTransport(uds=socket_path)
            self.client = httpx.Client(
                transport=self.transport, base_url="http://localhost/1.0", timeout=timeout
            )
        except Exception:
            # Fallback for environments without direct socket support during mock tests
            self.client = httpx.Client(base_url="http://localhost/1.0", timeout=timeout)

    def _wait_for_operation(self, response: httpx.Response) -> dict[str, Any]:
        if response.status_code not in (200, 201, 202):
            raise IncusError(f"Incus API error {response.status_code}: {response.text}")
        body = response.json()
        metadata = body.get("metadata") or {}
        operation_url = (
            response.headers.get("X-Incus-Operation")
            or metadata.get("id")
        )
        if body.get("status_code") == 103 and operation_url:
            op_id = str(operation_url).rsplit("/", 1)[-1]
            poll = self.client.get(f"/operations/{op_id}/wait?timeout=120")
            poll.raise_for_status()
            op_meta = poll.json().get("metadata") or {}
            if op_meta.get("status") == "Failure":
                raise IncusError(
                    f"Incus async operation failed: {op_meta.get('err', 'Unknown async error')}"
                )
            return op_meta
        return metadata

    def list_instances(self) -> list[dict[str, Any]]:
        response = self.client.get("/instances?recursion=1")
        response.raise_for_status()
        return response.json()["metadata"]

    def create_from_profile(self, name: str, profile_name: str) -> dict[str, Any]:
        payload = {
            "name": name,
            "source": {
                "type": "image",
                "alias": "debian/13",
                "server": "https://images.linuxcontainers.org",
            },
            "profiles": ["default", profile_name],
        }
        response = self.client.post("/instances", json=payload)
        return self._wait_for_operation(response)

    def set_state(self, name: str, action: str) -> dict[str, Any]:
        payload = {"action": action, "timeout": 30}
        response = self.client.put(f"/instances/{name}/state", json=payload)
        return self._wait_for_operation(response)

    def delete_instance(self, name: str) -> dict[str, Any]:
        snap_name = f"pre-del-{int(time.time())}"
        try:
            self._snapshot(name, snap_name)
        except (IncusError, httpx.HTTPError, Exception):
            pass
        response = self.client.delete(f"/instances/{name}")
        return self._wait_for_operation(response)

    def _snapshot(self, name: str, snapshot_name: str) -> None:
        response = self.client.post(
            f"/instances/{name}/snapshots", json={"name": snapshot_name}
        )
        self._wait_for_operation(response)
