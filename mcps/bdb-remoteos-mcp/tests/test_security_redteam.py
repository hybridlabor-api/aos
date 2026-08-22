from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("REMOTEOS_API_KEY", "test-key-1234")
os.environ.setdefault("GATEKEEPER_API_KEY", "test-key-1234")
os.environ.setdefault("GATEKEEPER_SIGNING_KEY", "unit-test-signing-key")

from bdb_remoteos_mcp.main import app, state  # noqa: E402
from tests.mock_incus import MOCK_INSTANCES  # noqa: E402

AUTH = {"X-API-Key": "test-key-1234"}
AGENT = "agent=overwatch-agent"


@pytest.fixture(autouse=True)
def mock_backend(monkeypatch):
    MOCK_INSTANCES.clear()
    monkeypatch.setattr(state.incus, "client", _mock_client())
    yield


def _mock_client():
    from tests.mock_incus import mock_app
    from fastapi.testclient import TestClient
    import httpx

    tc = TestClient(mock_app)

    def handler(request: httpx.Request) -> httpx.Response:
        body = request.read()
        kwargs = {}
        if body:
            import json as _json

            kwargs["json"] = _json.loads(body)
        resp = tc.request(request.method, request.url.path, **kwargs)
        return httpx.Response(resp.status_code, content=resp.content, headers=dict(resp.headers))

    transport = httpx.MockTransport(handler)
    return httpx.Client(transport=transport, base_url="http://localhost/1.0")


def test_health():
    with TestClient(app) as c:
        assert c.get("/health").json()["status"] == "ok"


def test_api_key_required():
    with TestClient(app) as c:
        r = c.post(
            "/tools/incus_manage_instance?agent=overwatch",
            json={"container_name": "kunde-1", "action": "delete", "reason": "cleanup test"},
        )
        assert r.status_code == 401


def test_shell_injection_blocked():
    """Red-Team Test 1: Command injection via container name."""
    with TestClient(app) as c:
        r = c.post(
            f"/tools/incus_create_instance?{AGENT}",
            headers=AUTH,
            json={"client_name": "kunde; rm -rf /"},
        )
        assert r.status_code == 422


def test_backtick_and_dollar_injection_blocked():
    with TestClient(app) as c:
        for payload_name in ["kunde`id`", "kunde$(whoami)", "kunde|cat /etc/passwd"]:
            r = c.post(
                f"/tools/incus_create_instance?{AGENT}",
                headers=AUTH,
                json={"client_name": payload_name},
            )
            assert r.status_code == 422, payload_name


def test_leading_trailing_dash_blocked():
    """Incus hostname constraint: no leading/trailing hyphens."""
    with TestClient(app) as c:
        for payload_name in ["-kunde", "kunde-", "-"]:
            r = c.post(
                f"/tools/incus_create_instance?{AGENT}",
                headers=AUTH,
                json={"client_name": payload_name},
            )
            assert r.status_code == 422, payload_name
        ok = c.post(
            f"/tools/incus_create_instance?{AGENT}",
            headers=AUTH,
            json={"client_name": "a-b"},
        )
        assert ok.status_code == 200


def test_quota_escalation_blocked():
    """Red-Team Test 2: Quota escalation."""
    with TestClient(app) as c:
        r = c.post(
            f"/tools/incus_create_instance?{AGENT}",
            headers=AUTH,
            json={"client_name": "kunde-escalate", "cpu_cores": 64, "ram_gb": 256},
        )
        assert r.status_code == 422


def test_unsigned_deletion_goes_to_queue():
    """Red-Team Test 3: Destructive action without token must not execute."""
    MOCK_INSTANCES["kunde-1"] = {"name": "kunde-1", "status": "Running", "profiles": []}
    with TestClient(app) as c:
        r = c.post(
            f"/tools/incus_manage_instance?{AGENT}",
            headers=AUTH,
            json={"container_name": "kunde-1", "action": "delete", "reason": "customer churn"},
        )
        body = r.json()
        assert r.status_code == 200
        assert body["status"] == "pending_approval"
        assert MOCK_INSTANCES["kunde-1"]["status"] == "Running"


def test_signed_approval_executes_delete():
    """Red-Team Test 3b: Signed approval unlocks execution."""
    MOCK_INSTANCES["kunde-1"] = {"name": "kunde-1", "status": "Running", "profiles": []}
    with TestClient(app) as c:
        enqueue = c.post(
            f"/tools/incus_manage_instance?{AGENT}",
            headers=AUTH,
            json={"container_name": "kunde-1", "action": "delete", "reason": "customer churn"},
        ).json()
        request_id = enqueue["request_id"]

        wrong = c.post(
            "/approvals/decide?admin=tkd",
            headers=AUTH,
            json={"token": "deadbeef" * 8},
        )
        assert wrong.status_code == 410

        tok = c.post(f"/approvals/{request_id}/token?admin=tkd", headers=AUTH).json()
        decide = c.post("/approvals/decide?admin=tkd", headers=AUTH, json={"token": tok["approval_token"]})
        assert decide.status_code == 200
        assert decide.json()["status"] == "executed"
        assert "kunde-1" not in MOCK_INSTANCES


def test_expired_token_rejected(monkeypatch):
    """Red-Team Test 4: Approval after expiry window fails."""
    MOCK_INSTANCES["kunde-old"] = {"name": "kunde-old", "status": "Running", "profiles": []}
    with TestClient(app) as c:
        enqueue = c.post(
            f"/tools/incus_manage_instance?{AGENT}",
            headers=AUTH,
            json={"container_name": "kunde-old", "action": "delete", "reason": "expired flow"},
        ).json()
        request_id = enqueue["request_id"]

        from datetime import timedelta

        record = state.queue.get(request_id)
        assert record is not None
        past = (record.expires_at - timedelta(minutes=20)).isoformat()
        with state.queue.conn as conn:
            conn.execute(
                "UPDATE approval_queue SET expires_at=? WHERE request_id=?",
                (past, request_id),
            )
        state.queue.expire_stale()

        tok = c.post(f"/approvals/{request_id}/token?admin=noah", headers=AUTH)
        assert tok.status_code == 410
