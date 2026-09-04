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
# F1 (rev 3): the admin group is configurable. The suite pins it to the shipped
# default so it exercises the real configured value instead of a literal that
# only exists in the test file.
os.environ.setdefault("GATEKEEPER_ADMIN_GROUP", "dev_admin")
ADMIN_GROUP = os.environ["GATEKEEPER_ADMIN_GROUP"]

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

        admin_session = {**AUTH, "Remote-User": "tkd", "Remote-Groups": ADMIN_GROUP}
        wrong = c.post(
            "/approvals/decide",
            headers=admin_session,
            json={"token": "deadbeef" * 8},
        )
        assert wrong.status_code == 410

        tok = c.post(f"/approvals/{request_id}/token", headers=admin_session).json()
        decide = c.post("/approvals/decide", headers=admin_session, json={"token": tok["approval_token"]})
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

        tok = c.post(
            f"/approvals/{request_id}/token",
            headers={**AUTH, "Remote-User": "noah", "Remote-Groups": ADMIN_GROUP},
        )
        assert tok.status_code == 410


# ===========================================================================
# Phase 0 security remediation (execution plan rev 2) — F1 regression guards
#
# This package is published publicly. The guard deliberately fails closed:
# where no authenticating proxy supplies Remote-User the approval endpoints
# return 401 and are simply unusable, which is the correct default for a
# distributed package that must never be able to approve its own requests.
# ===========================================================================

ADMIN_SESSION = {**AUTH, "Remote-User": "tkd", "Remote-Groups": f"dev,{ADMIN_GROUP}"}
NON_ADMIN_SESSION = {**AUTH, "Remote-User": "mallory", "Remote-Groups": "users"}


def _queue_delete(c, container: str) -> str:
    MOCK_INSTANCES[container] = {"name": container, "status": "Running", "profiles": []}
    body = c.post(
        f"/tools/incus_manage_instance?{AGENT}",
        headers=AUTH,
        json={"container_name": container, "action": "delete", "reason": "phase0 regression"},
    ).json()
    return body["request_id"]


def test_f1_decide_approval_without_remote_user_is_401():
    """A valid API key alone must not be able to approve anything."""
    with TestClient(app) as c:
        rid = _queue_delete(c, "kunde-f1a")
        token = state.queue.pending_token(rid)
        r = c.post("/approvals/decide?admin=tkd", headers=AUTH, json={"token": token})
        assert r.status_code == 401
        assert state.queue.get(rid).status == "pending"
        assert MOCK_INSTANCES["kunde-f1a"]["status"] == "Running"


def test_f1_decide_approval_without_admins_group_is_403():
    with TestClient(app) as c:
        rid = _queue_delete(c, "kunde-f1b")
        token = state.queue.pending_token(rid)
        r = c.post("/approvals/decide", headers=NON_ADMIN_SESSION, json={"token": token})
        assert r.status_code == 403
        assert state.queue.get(rid).status == "pending"


def test_f1_substring_group_is_not_sufficient():
    """F1 advisory: `non-<group>` must not satisfy the admin-group requirement."""
    with TestClient(app) as c:
        rid = _queue_delete(c, "kunde-f1c")
        token = state.queue.pending_token(rid)
        r = c.post(
            "/approvals/decide",
            headers={**AUTH, "Remote-User": "mallory", "Remote-Groups": f"non-{ADMIN_GROUP}"},
            json={"token": token},
        )
        assert r.status_code == 403
        assert state.queue.get(rid).status == "pending"


def test_f1_approver_comes_from_remote_user_not_query_param():
    with TestClient(app) as c:
        rid = _queue_delete(c, "kunde-f1d")
        token = state.queue.pending_token(rid)
        r = c.post("/approvals/decide?admin=attacker", headers=ADMIN_SESSION, json={"token": token})
        assert r.status_code == 200
        record = state.queue.get(rid)
        assert record.approved_by == "tkd"
        assert record.approved_by not in ("attacker", "admin")


def test_f1_issue_approval_token_requires_admin_session():
    with TestClient(app) as c:
        rid = _queue_delete(c, "kunde-f1e")
        assert c.post(f"/approvals/{rid}/token?admin=tkd", headers=AUTH).status_code == 401
        assert c.post(f"/approvals/{rid}/token", headers=NON_ADMIN_SESSION).status_code == 403
        ok = c.post(f"/approvals/{rid}/token", headers=ADMIN_SESSION)
        assert ok.status_code == 200
        assert ok.json()["approval_token"] == state.queue.pending_token(rid)


def test_f1_legacy_admins_group_is_rejected():
    """F1 (rev 3): `admins` was never provisioned and must not authorize anything.

    The rev 2 build hardcoded this literal. No LDAP group of that name exists,
    so the guard locked out every real operator while still granting approval
    rights to anyone who could present a group that happened to be called
    `admins`. The configured group is the only one that counts.
    """
    with TestClient(app) as c:
        rid = _queue_delete(c, "kunde-f1f")
        token = state.queue.pending_token(rid)
        r = c.post(
            "/approvals/decide",
            headers={**AUTH, "Remote-User": "tkd", "Remote-Groups": "dev,admins"},
            json={"token": token},
        )
        assert r.status_code == 403
        assert state.queue.get(rid).status == "pending"
        assert MOCK_INSTANCES["kunde-f1f"]["status"] == "Running"


def test_f1_admin_group_comes_from_the_environment():
    """F1 (rev 3): the admin group is configuration, never a source literal."""
    import inspect

    from bdb_remoteos_mcp import main as gateway_main

    assert gateway_main.ADMIN_GROUP == os.environ["GATEKEEPER_ADMIN_GROUP"]
    source = inspect.getsource(gateway_main._require_admin_identity)
    assert '"admins"' not in source, "hardcoded group literal survived in the guard"
    assert "ADMIN_GROUP" in source


def test_f1_mcp_decide_tool_reports_401_as_a_tool_error(monkeypatch):
    """F1 (rev 3): the in-process fallback must fail legibly, never raise.

    Copy C has no identity-aware proxy in front of `decide_approval`, so the F1
    guard answers 401 for the direct/local path. That loss of function is the
    intended fail-closed outcome for a publicly distributed package — but an MCP
    tool has to return it as a structured result, not let an HTTPException
    escape through the transport.
    """
    monkeypatch.delenv("REMOTEOS_GATEWAY_URL", raising=False)
    from bdb_remoteos_mcp.server import remoteos_approval_queue_decide

    with TestClient(app) as c:
        rid = _queue_delete(c, "kunde-f1g")

    res = remoteos_approval_queue_decide(rid)
    assert isinstance(res, dict)
    assert res["status"] == "error"
    assert res["code"] == 401
    assert res["detail"]
    assert state.queue.get(rid).status == "pending"


def test_f1_no_literal_admin_fallback_in_approval_path():
    """Contract: neither approval endpoint may derive an approver from a default."""
    import inspect

    from bdb_remoteos_mcp import main as gateway_main

    for symbol in (gateway_main.decide_approval, gateway_main.issue_approval_token):
        source = inspect.getsource(symbol)
        assert 'or "admin"' not in source, symbol.__name__
        assert "approver=admin" not in source, symbol.__name__


def test_f1_public_package_contains_no_infrastructure_constants():
    """Copy C is world-readable on npm: no hostnames, IPs or fingerprints."""
    import re as _re
    from pathlib import Path

    package_root = Path(__file__).resolve().parents[1] / "src"
    ipv4 = _re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
    for path in package_root.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        assert not ipv4.search(text), f"IP literal in public package: {path}"
        for forbidden in ("rcentry.pro", "rcentry.cloud", "gateway.rcentry", "netcup"):
            assert forbidden not in text.lower(), f"{forbidden} in public package: {path}"
