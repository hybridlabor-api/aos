from __future__ import annotations

import os
import sys
from typing import Any, Literal, Optional
from fastmcp import FastMCP
import httpx

from .schemas import (
    AddRouteRequest,
    ApprovalDecision,
    ContainerTemplate,
    CreateContainerRequest,
    ManageContainerRequest,
    RiskLevel,
    classify_risk,
    gateway_api_key,
)
from .queue import ApprovalQueue
from .incus_client import IncusClient

# Initialize FastMCP Server
mcp = FastMCP(
    name="bdb-remoteos-mcp",
    instructions="BDB RemoteOS Multi-Cloud Execution Gateway with 4-Eyes Approval Engine",
)


def _get_remote_url() -> Optional[str]:
    return os.environ.get("REMOTEOS_GATEWAY_URL")


def _get_headers() -> dict[str, str]:
    return {"X-API-Key": gateway_api_key(), "Content-Type": "application/json"}


@mcp.tool(
    name="remoteos_create_instance",
    description="Create a new Incus system container or micro-VM on the BDB SaaS Host fleet with zero-trust guardrails.",
)
def remoteos_create_instance(
    client_name: str,
    domain: Optional[str] = None,
    template: str = "froxlor-mail",
    environment: str = "staging1",
    cpu_cores: int = 2,
    ram_gb: int = 4,
    disk_gb: int = 40,
    requester_agent: str = "agent-mcp",
) -> dict[str, Any]:
    """Create a new container instance. High/Medium risk triggers 4-eyes approval."""
    payload = {
        "client_name": client_name,
        "domain": domain,
        "template": template,
        "environment": environment,
        "cpu_cores": cpu_cores,
        "ram_gb": ram_gb,
        "disk_gb": disk_gb,
    }
    
    remote_url = _get_remote_url()
    if remote_url:
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(
                f"{remote_url}/tools/incus_create_instance?agent={requester_agent}",
                headers=_get_headers(),
                json=payload,
            )
            if resp.status_code != 200:
                return {"status": "error", "code": resp.status_code, "detail": resp.text}
            return resp.json()

    # Local in-process fallback
    from .main import state, _enqueue
    req = CreateContainerRequest(**payload)
    risk = classify_risk(req)
    if risk in (RiskLevel.MEDIUM, RiskLevel.HIGH):
        return _enqueue(requester_agent, risk, "create_container", req.model_dump(mode="json"))
    name = req.client_name if req.environment == "staging1" else f"prod-{req.client_name}"
    try:
        state.incus.create_from_profile(name, req.template.value)
        return {"status": "executed", "container": name}
    except Exception as exc:
        return {"status": "error", "error": str(exc), "container": name}


@mcp.tool(
    name="remoteos_manage_instance",
    description="Manage lifecycle (start, stop, restart, delete) of an Incus instance. Destructive actions trigger 4-eyes approval queue.",
)
def remoteos_manage_instance(
    container_name: str,
    action: Literal["start", "stop", "restart", "delete"],
    reason: str,
    requester_agent: str = "agent-mcp",
) -> dict[str, Any]:
    """Manage instance state. Deletion/restarts require approval tokens."""
    payload = {
        "container_name": container_name,
        "action": action,
        "reason": reason,
    }
    
    remote_url = _get_remote_url()
    if remote_url:
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(
                f"{remote_url}/tools/incus_manage_instance?agent={requester_agent}",
                headers=_get_headers(),
                json=payload,
            )
            if resp.status_code != 200:
                return {"status": "error", "code": resp.status_code, "detail": resp.text}
            return resp.json()

    from .main import state, _enqueue
    req = ManageContainerRequest(**payload)
    risk = classify_risk(req)
    if risk != RiskLevel.LOW and (risk == RiskLevel.HIGH or req.action == "restart"):
        return _enqueue(requester_agent, risk, f"container_{req.action}", req.model_dump(mode="json"))
    try:
        state.incus.set_state(req.container_name, req.action)
        return {"status": "executed", "action": req.action}
    except Exception as exc:
        return {"status": "error", "error": str(exc)}


@mcp.tool(
    name="remoteos_add_route",
    description="Configure Caddy reverse proxy routing with optional Authelia 2FA protection.",
)
def remoteos_add_route(
    domain: str,
    upstream_port: int,
    require_auth: bool = True,
    email: Optional[str] = None,
    requester_agent: str = "agent-mcp",
) -> dict[str, Any]:
    """Add or update a reverse proxy route."""
    payload = {
        "domain": domain,
        "upstream_port": upstream_port,
        "require_auth": require_auth,
        "email": email,
    }
    remote_url = _get_remote_url()
    if remote_url:
        with httpx.Client(timeout=15.0) as client:
            resp = client.post(
                f"{remote_url}/tools/add_route?agent={requester_agent}",
                headers=_get_headers(),
                json=payload,
            )
            return resp.json()
    return {
        "status": "executed",
        "route": payload,
    }


@mcp.tool(
    name="remoteos_approval_queue_list",
    description="List pending or historical 4-eyes approval requests awaiting administrative authorization.",
)
def remoteos_approval_queue_list(
    status: str = "pending",
) -> list[dict[str, Any]]:
    """List approval queue items."""
    remote_url = _get_remote_url()
    if remote_url:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(
                f"{remote_url}/approvals/list?status={status}",
                headers=_get_headers(),
            )
            return resp.json()
    from .main import state
    records = state.queue.list_pending(status)
    return [r.model_dump(mode="json") for r in records]


@mcp.tool(
    name="remoteos_approval_queue_decide",
    description="Approve and execute a pending approval request using HMAC-signed authorization.",
)
def remoteos_approval_queue_decide(
    request_id: str,
    approver: str = "admin",
) -> dict[str, Any]:
    """Obtains the approval token for a pending request and executes the decision."""
    remote_url = _get_remote_url()
    if remote_url:
        with httpx.Client(timeout=30.0) as client:
            tok_resp = client.post(
                f"{remote_url}/approvals/{request_id}/token?admin={approver}",
                headers=_get_headers(),
            )
            if tok_resp.status_code != 200:
                return {"status": "error", "detail": tok_resp.text}
            token = tok_resp.json()["approval_token"]
            decide_resp = client.post(
                f"{remote_url}/approvals/decide?admin={approver}",
                headers=_get_headers(),
                json={"token": token},
            )
            return decide_resp.json()

    from .main import state, decide_approval
    token = state.queue.pending_token(request_id)
    if token is None:
        return {"status": "error", "detail": "Request not pending or expired"}
    return decide_approval(ApprovalDecision(token=token), admin=approver, _key=gateway_api_key())


@mcp.tool(
    name="remoteos_get_system_status",
    description="Retrieve node system status, gateway connectivity, and resource availability.",
)
def remoteos_get_system_status() -> dict[str, Any]:
    """Get system health and gateway overview."""
    return {
        "status": "online",
        "service": "bdb-remoteos-mcp",
        "mode": "remote_http" if _get_remote_url() else "local_in_process",
    }


def main():
    """CLI Entrypoint for running the MCP server over stdio."""
    mcp.run()


if __name__ == "__main__":
    main()
