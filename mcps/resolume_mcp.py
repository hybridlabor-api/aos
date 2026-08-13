# /// script
# dependencies = [
#   "mcp>=1.0.0,<2.0.0",
# ]
# ///

import json
import urllib.request
import urllib.error
from typing import Any, Dict, Optional
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("BDB Resolume MCP")

RESOLUME_API_BASE = "http://localhost:8080/api/v1"

def _send_request(endpoint: str, method: str = 'GET', data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    url = f"{RESOLUME_API_BASE.rstrip('/')}/{endpoint.lstrip('/')}"
    headers = {}
    
    req_data = None
    if data is not None:
        req_data = json.dumps(data).encode('utf-8')
        headers['Content-Type'] = 'application/json'
        
    req = urllib.request.Request(url, data=req_data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as response:
            if response.status == 204:
                return {"status": "success"}
            body = response.read().decode('utf-8')
            return json.loads(body) if body else {"status": "success"}
    except urllib.error.URLError as e:
        return {"error": str(e)}

@mcp.tool()
def resolume_ping() -> str:
    """Check if Resolume is running by calling the product endpoint."""
    res = _send_request("/product")
    if "error" in res:
        return f"Resolume API not reachable: {res['error']}"
    return f"Resolume API is active. Product: {res.get('name', 'Unknown')}"

@mcp.tool()
def trigger_clip(layer: int, clip: int) -> Dict[str, Any]:
    """Trigger a specific clip on a specific layer (1-indexed)."""
    return _send_request(f"/composition/layers/{layer}/clips/{clip}/connect", method='POST')

@mcp.tool()
def clear_layer(layer: int) -> Dict[str, Any]:
    """Clear a specific layer (1-indexed)."""
    return _send_request(f"/composition/layers/{layer}/clear", method='POST')

@mcp.tool()
def get_composition() -> Dict[str, Any]:
    """Get the current Resolume composition state."""
    return _send_request("/composition")

@mcp.tool()
def set_composition_speed(speed: float) -> Dict[str, Any]:
    """Set the speed of the composition."""
    return _send_request("/composition/speed", method='PUT', data={"value": speed})

if __name__ == "__main__":
    mcp.run()
