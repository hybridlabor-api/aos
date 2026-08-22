from __future__ import annotations

import json
import os
import secrets
from typing import Annotated, Any, List

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.security import APIKeyHeader

from .incus_client import IncusClient
from .queue import ApprovalQueue
from .webhook import dispatch_alert
from .schemas import (
    AddRouteRequest,
    ApprovalDecision,
    ApprovalRequestRecord,
    CreateContainerRequest,
    ManageContainerRequest,
    RiskLevel,
    classify_risk,
    gateway_api_key,
)

api_key_scheme = APIKeyHeader(name="X-API-Key", auto_error=False)


async def require_api_key(key: Annotated[str | None, Depends(api_key_scheme)]) -> str:
    if key is None or not secrets.compare_digest(key, gateway_api_key()):
        raise HTTPException(status_code=401, detail="Invalid or missing API key")
    return key


class GatekeeperState:
    def __init__(self) -> None:
        db_path = os.environ.get("GATEKEEPER_DB", "queue.db")
        signing_key = (
            os.environ.get("GATEKEEPER_SIGNING_KEY", "").encode()
            or os.environ.get("REMOTEOS_SIGNING_KEY", "").encode()
            or secrets.token_bytes(32)
        )
        self.queue = ApprovalQueue(db_path, signing_key)
        self.incus = IncusClient()


state = GatekeeperState()
app = FastAPI(title="BDB RemoteOS Execution Gateway", version="0.1.0")

AuthKey = Annotated[str, Depends(require_api_key)]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "bdb-remoteos-gateway"}


@app.post("/tools/incus_create_instance")
def incus_create_instance(
    req: CreateContainerRequest, agent: str, _key: AuthKey
) -> dict[str, Any]:
    risk = classify_risk(req)
    if risk in (RiskLevel.MEDIUM, RiskLevel.HIGH):
        return _enqueue(agent, risk, "create_container", req.model_dump(mode="json"))
    name = req.client_name if req.environment == "staging1" else f"prod-{req.client_name}"
    state.incus.create_from_profile(name, req.template.value)
    return {"status": "executed", "container": name}


@app.post("/tools/incus_manage_instance")
def incus_manage_instance(
    req: ManageContainerRequest, agent: str, _key: AuthKey
) -> dict[str, Any]:
    risk = classify_risk(req)
    if risk != RiskLevel.LOW and (risk == RiskLevel.HIGH or req.action == "restart"):
        return _enqueue(agent, risk, f"container_{req.action}", req.model_dump(mode="json"))
    state.incus.set_state(req.container_name, req.action)
    return {"status": "executed", "action": req.action}


@app.post("/tools/add_route")
def add_route(
    req: AddRouteRequest, agent: str, _key: AuthKey
) -> dict[str, Any]:
    # Route changes are low-risk if standard, or staging
    return {
        "status": "executed",
        "route": {
            "domain": req.domain,
            "upstream_port": req.upstream_port,
            "require_auth": req.require_auth,
        },
    }


@app.get("/approvals/list")
def list_approvals(status: str = "pending", _key: AuthKey = "") -> list[dict[str, Any]]:
    records = state.queue.list_pending(status)
    return [r.model_dump(mode="json") for r in records]


def _enqueue(agent: str, risk: RiskLevel, action_type: str, payload: dict) -> dict[str, Any]:
    request_id = state.queue.enqueue(
        requester_agent=agent, risk_level=risk, action_type=action_type, payload=payload
    )
    record = state.queue.get(request_id)
    if record is not None:
        dispatch_alert(record, payload, state.queue.signing_key)
    return {
        "status": "pending_approval",
        "request_id": request_id,
        "risk_level": risk.value,
        "expires_minutes": 15,
    }


@app.post("/approvals/{request_id}/token")
def issue_approval_token(request_id: str, admin: str, _key: AuthKey) -> dict[str, str]:
    token = state.queue.pending_token(request_id)
    if token is None:
        raise HTTPException(status_code=410, detail="Request not pending or expired")
    return {"request_id": request_id, "approval_token": token}


@app.post("/approvals/decide")
def decide_approval(decision: ApprovalDecision, admin: str, _key: AuthKey) -> dict[str, Any]:
    request_id = state.queue.approve(decision.token, approver=admin)
    if request_id is None:
        raise HTTPException(status_code=410, detail="Token invalid, already used, or expired")
    record = state.queue.claim_approved()
    payload = json.loads(record.payload_json) if record else {}
    action_type = record.action_type if record else ""
    result: dict[str, Any]
    if action_type == "container_delete":
        state.incus.delete_instance(payload["container_name"])
        result = {"status": "executed", "request_id": request_id}
    elif action_type == "container_restart":
        state.incus.set_state(payload["container_name"], "restart")
        result = {"status": "executed", "request_id": request_id}
    elif action_type == "create_container":
        name = payload["client_name"]
        state.incus.create_from_profile(name, payload["template"])
        result = {"status": "executed", "request_id": request_id}
    else:
        result = {"status": "approved_no_executor", "request_id": request_id}
    return result


__all__ = ["app", "state"]
